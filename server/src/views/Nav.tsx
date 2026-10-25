import type { CurrentUser } from '../auth/service.ts';
import { ACCOUNT_SECTIONS } from './accountSections.ts';

interface NavProps {
  user: CurrentUser | null;
  /** Request path, used to mark the active link and as the return address after logging in. */
  path: string;
}

function Brand() {
  return (
    <a class="navbar-brand" href="/">
      <i class="fa-solid fa-location-dot ft-brand-icon" aria-hidden="true"></i>
      Flytrace
    </a>
  );
}

/**
 * The button that opens the menu on small screens. Logged-out visitors get words ("Log in, Register, etc") so it is
 * clear that the log-in form is inside; logged-in users get the classic "burger" icon.
 */
function Toggler({ withText }: { withText?: boolean }) {
  return (
    <button class={`navbar-toggler ft-toggler${withText ? ' ft-toggler-text' : ''}`} type="button" data-bs-toggle="collapse"
            data-bs-target="#navMain" aria-controls="navMain" aria-expanded="false" aria-label="Toggle navigation">
      {withText
        ? <>Log in, Register<span class="ft-nano-hide">, etc</span> <i class="fa-solid fa-caret-down" aria-hidden="true"></i></>
        : <span class="navbar-toggler-icon"></span>}
    </button>
  );
}

function navLink(path: string, href: string): { class: string; 'aria-current'?: 'page' } {
  return path === href || (href !== '/' && path.startsWith(`${href}/`))
    ? { class: 'nav-link active', 'aria-current': 'page' }
    : { class: 'nav-link' };
}

interface MoreLink {
  href: string;
  label: string;
  /** Font Awesome classes of the icon, if any. */
  icon?: string;
  external?: boolean;
  /** Shown as a button in the phone menu. */
  button?: boolean;
}

/** The "Register, etc" entries; `null` is a divider. Shown as a drop-down on wide screens and inline on phones. */
const MORE_ITEMS: (MoreLink | null)[] = [
  { href: '/register', label: 'Register', icon: 'fa-solid fa-user-plus', button: true },
  { href: '/forgot-password', label: 'Forgot password?', icon: 'fa-solid fa-key' },
  null,
  { href: '/contact', label: 'Contact us', icon: 'fa-regular fa-envelope' },
];

/**
 * The day / night switch, no words: moon, an oval track with a round knob, sun. The knob sits next to the active mode
 * (the stylesheet moves it from the theme on <html>, so it is right without knowing the theme here and moves at once
 * when public/js/app.js switches). It is a link, so that it also works without JavaScript: /theme flips the cookie and
 * returns to this page. app.js gives it role="switch" and aria-checked (checked = night) when it runs.
 */
function ThemeSwitch({ path, className }: { path: string; className?: string }) {
  return (
    <a class={`ft-switch ${className ?? ''}`} href={themeHref(path)} data-theme-toggle aria-label="Night mode" title="Day / night mode">
      <span class="ft-sym ft-sym-moon" aria-hidden="true">&#9790;</span>
      <span class="ft-switch-track" aria-hidden="true"><span class="ft-switch-knob"></span></span>
      <span class="ft-sym ft-sym-sun" aria-hidden="true">&#9788;</span>
    </a>
  );
}

/** Wide screens: the switch in the bar next to the user name (or "Register, etc"). */
function ThemeButton({ path }: { path: string }) {
  return (
    <ul class="navbar-nav d-none d-lg-flex">
      <li class="nav-item d-flex align-items-center px-2">
        <ThemeSwitch path={path} />
      </li>
    </ul>
  );
}

/** Without JavaScript the link goes to /theme, which flips the cookie and returns to this page. */
function themeHref(path: string): string {
  return `/theme?returnUrl=${encodeURIComponent(path)}`;
}

function LinkContent({ item }: { item: MoreLink }) {
  return (
    <>
      {item.icon && <><i class={`${item.icon} fa-fw`} aria-hidden="true"></i>{' '}</>}
      {item.label}
      {item.external && <>{' '}<i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i></>}
    </>
  );
}

/** Wide screens: one "Register, etc" drop-down. */
function MoreDropdown({ alignEnd }: { alignEnd: boolean }) {
  return (
    <ul class={`navbar-nav d-none d-lg-flex ${alignEnd ? 'ms-lg-auto' : 'ms-lg-3'}`}>
      <li class="nav-item dropdown">
        <a class="nav-link dropdown-toggle" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
          Register, etc
        </a>
        <ul class="dropdown-menu dropdown-menu-lg-end">
          {MORE_ITEMS.map((item) => item
            ? <li><a class="dropdown-item" href={item.href}><LinkContent item={item} /></a></li>
            : <li><hr class="dropdown-divider" /></li>)}
        </ul>
      </li>
    </ul>
  );
}

/** Phones: the same entries listed right in the opened menu, no second tap needed. */
function MoreInline({ path }: { path: string }) {
  return (
    <div class="navbar-nav d-lg-none ft-more-inline">
      {MORE_ITEMS.map((item) => item
        ? item.button
          ? <a class="btn btn-outline-light w-100 my-3" href={item.href}><LinkContent item={item} /></a>
          : <a class="nav-link py-2" href={item.href}><LinkContent item={item} /></a>
        : <hr class="border-light opacity-25 my-2" />)}
      <hr class="border-light opacity-25 my-2" />
      <div class="nav-link py-2"><ThemeSwitch path={path} /></div>
    </div>
  );
}

/** Anonymous visitors: login form right in the bar, plus the "Register, etc" entries. */
function AnonymousNav({ path }: { path: string }) {
  const onLoginPage = path.split('?')[0] === '/login';
  return (
    <nav class="navbar navbar-expand-lg navbar-dark ft-navbar">
      <div class="container-fluid">
        <Brand />
        <Toggler withText />
        <div class="collapse navbar-collapse" id="navMain">
          {!onLoginPage && (
            <form class="ft-login-form d-lg-flex flex-grow-1 gap-2 mt-3 mt-lg-0 ms-lg-4" method="post" action="/login">
              <input type="hidden" name="returnUrl" value={path} />
              <input class="form-control mb-2 mb-lg-0" name="username" placeholder="User name or email" type="text"
                     autocomplete="username" aria-label="User name or email" required />
              <div class="input-group mb-2 mb-lg-0">
                <input class="form-control" name="password" placeholder="Password" type="password"
                       autocomplete="current-password" aria-label="Password" required />
                <button class="btn btn-light ft-pw-toggle" type="button" hidden aria-label="Show password" aria-pressed="false">
                  <i class="fa-regular fa-eye fa-fw" aria-hidden="true"></i>
                </button>
              </div>
              <button class="btn btn-primary text-nowrap" type="submit">
                <span class="ft-label">Log in</span>
                <span class="ft-busy d-none">Logging in&hellip; <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></span>
              </button>
            </form>
          )}
          <MoreDropdown alignEnd={onLoginPage} />
          <ThemeButton path={path} />
          <MoreInline path={path} />
        </div>
      </div>
    </nav>
  );
}

function LogoutForm({ className, buttonClass }: { className?: string; buttonClass: string }) {
  return (
    <form class={className} method="post" action="/logout">
      <button class={buttonClass} type="submit"><i class="fa-solid fa-right-from-bracket fa-fw" aria-hidden="true"></i> Log out</button>
    </form>
  );
}

/** "<username> v": the account pages and Log out. A drop-down on wide screens, listed in the opened menu on phones. */
function UserMenu({ user, path }: { user: CurrentUser; path: string }) {
  const here = path === '/account' || path.startsWith('/account/');
  return (
    <>
      <ThemeButton path={path} />
      <ul class="navbar-nav d-none d-lg-flex">
        <li class="nav-item dropdown">
          <a class={`nav-link dropdown-toggle${here ? ' active' : ''}`} href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="fa-regular fa-user" aria-hidden="true"></i> {user.username}
          </a>
          <ul class="dropdown-menu dropdown-menu-end">
            {ACCOUNT_SECTIONS.map((s) => (
              <li><a class={`dropdown-item${path === s.href ? ' active' : ''}`} href={s.href}>
                <i class={`${s.icon} fa-fw`} aria-hidden="true"></i> {s.label}
              </a></li>
            ))}
            <li><hr class="dropdown-divider" /></li>
            <li><LogoutForm buttonClass="dropdown-item" /></li>
          </ul>
        </li>
      </ul>
      <div class="d-lg-none ft-more-inline">
        <hr class="border-light opacity-25 my-2" />
        <div class="navbar-nav">
          <div class="nav-link py-2"><ThemeSwitch path={path} /></div>
        </div>
        <hr class="border-light opacity-25 my-2" />
        <div class="ft-menu-heading ft-menu-user"><i class="fa-regular fa-user" aria-hidden="true"></i> {user.username}</div>
        <div class="navbar-nav">
          {ACCOUNT_SECTIONS.map((s) => (
            <a {...navLink(path, s.href)} class={`nav-link py-2 ps-3${path === s.href ? ' active' : ''}`} href={s.href}>
              <i class={`${s.icon} fa-fw`} aria-hidden="true"></i> {s.label}
            </a>
          ))}
        </div>
        <LogoutForm className="mt-2 mb-1" buttonClass="btn btn-outline-light btn-sm" />
      </div>
    </>
  );
}

function UserNav({ user, path }: { user: CurrentUser; path: string }) {
  return (
    <nav class="navbar navbar-expand-lg navbar-dark ft-navbar">
      <div class="container-fluid">
        <Brand />
        <Toggler />
        <div class="collapse navbar-collapse" id="navMain">
          <ul class="navbar-nav me-auto">
            <li class="nav-item"><a {...navLink(path, '/settings')} href="/settings">Settings</a></li>
            {user.roles.includes('Admins') && (
              <li class="nav-item"><a {...navLink(path, '/admin')} href="/admin">Admin</a></li>
            )}
          </ul>
          <UserMenu user={user} path={path} />
        </div>
      </div>
    </nav>
  );
}

export function Nav({ user, path }: NavProps) {
  return user ? <UserNav user={user} path={path} /> : <AnonymousNav path={path} />;
}
