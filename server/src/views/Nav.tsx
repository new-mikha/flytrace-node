import type { CurrentUser } from '../auth/service.ts';

interface NavProps {
  user: CurrentUser | null;
  /** Request path, used to mark the active link and as the return address after logging in. */
  path: string;
}

function Brand() {
  return (
    <a class="navbar-brand" href="/">
      <i class="fa-solid fa-location-dot ff-brand-icon" aria-hidden="true"></i>
      FlyTrace
    </a>
  );
}

/** The classic "burger" button that opens the menu on small screens. */
function Toggler() {
  return (
    <button class="navbar-toggler ff-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain"
            aria-controls="navMain" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
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
  { href: 'http://leonardo.flytrace.com', label: 'Leonardo to analyze saved GPS tracks', external: true },
  { href: 'http://gts.flytrace.com', label: 'OpenGTS for phone-based tracking', external: true },
  null,
  { href: '/contact', label: 'Contact us', icon: 'fa-regular fa-envelope' },
];

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
function MoreInline() {
  return (
    <div class="navbar-nav d-lg-none ff-more-inline">
      {MORE_ITEMS.map((item) => item
        ? item.button
          ? <a class="btn btn-outline-light w-100 my-3" href={item.href}><LinkContent item={item} /></a>
          : <a class="nav-link py-2" href={item.href}><LinkContent item={item} /></a>
        : <hr class="border-light opacity-25 my-2" />)}
    </div>
  );
}

/** Anonymous visitors: login form right in the bar, plus the "Register, etc" entries. */
function AnonymousNav({ path }: { path: string }) {
  const onLoginPage = path.split('?')[0] === '/login';
  return (
    <nav class="navbar navbar-expand-lg navbar-dark ff-navbar">
      <div class="container-fluid">
        <Brand />
        <Toggler />
        <div class="collapse navbar-collapse" id="navMain">
          {!onLoginPage && (
            <form class="ff-login-form d-lg-flex flex-grow-1 gap-2 mt-3 mt-lg-0 ms-lg-4" method="post" action="/login">
              <input type="hidden" name="returnUrl" value={path} />
              <input class="form-control mb-2 mb-lg-0" name="username" placeholder="User name or email" type="text"
                     autocomplete="username" aria-label="User name or email" required />
              <input class="form-control mb-2 mb-lg-0" name="password" placeholder="Password" type="password"
                     autocomplete="current-password" aria-label="Password" required />
              <button class="btn btn-primary text-nowrap" type="submit">
                <span class="ff-label">Log in</span>
                <span class="ff-busy d-none">Logging in&hellip; <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i></span>
              </button>
            </form>
          )}
          <MoreDropdown alignEnd={onLoginPage} />
          <MoreInline />
        </div>
      </div>
    </nav>
  );
}

function UserNav({ user, path }: { user: CurrentUser; path: string }) {
  return (
    <nav class="navbar navbar-expand-lg navbar-dark ff-navbar">
      <div class="container-fluid">
        <Brand />
        <Toggler />
        <div class="collapse navbar-collapse" id="navMain">
          <ul class="navbar-nav me-auto">
            <li class="nav-item"><a {...navLink(path, '/')} href="/">Home</a></li>
            <li class="nav-item"><a {...navLink(path, '/groups')} href="/groups">My groups</a></li>
            {user.roles.includes('Admins') && (
              <li class="nav-item"><a {...navLink(path, '/admin')} href="/admin">Admin</a></li>
            )}
          </ul>
          <form class="d-flex align-items-center gap-3 mt-3 mt-lg-0" method="post" action="/logout">
            <span class="navbar-text text-nowrap"><i class="fa-regular fa-user" aria-hidden="true"></i> {user.username}</span>
            <button class="btn btn-outline-light btn-sm text-nowrap" type="submit">Log out</button>
          </form>
        </div>
      </div>
    </nav>
  );
}

export function Nav({ user, path }: NavProps) {
  return user ? <UserNav user={user} path={path} /> : <AnonymousNav path={path} />;
}
