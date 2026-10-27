import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import type { ManagedUser } from '../repo/adminUsers.ts';
import { formatTimestamp } from './format.ts';
import { MIN_PASSWORD_LENGTH } from '../auth/accounts.ts';
import { Alert, ConfirmPasswordHints, EmailHints, Field, PasswordHints, Submit, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';

interface Common { user: CurrentUser; path: string; flash?: Flash | null }

/** `form` names the change that failed (its slug), so that only that form shows the messages. */
export type AdminErrors = Record<string, string | undefined>;

// ---- the sections of one user ----

/**
 * What an admin can do with a user, one page each, laid out like the settings: wide screens list them at the left of every page,
 * phones show the list alone (with the current values) as the first screen and each page alone with a way back.
 */
export const SECTION_SLUGS = ['lock', 'reset-link', 'password', 'email', 'email-status', 'end-sessions', 'disable-2fa'] as const;
export type SectionSlug = typeof SECTION_SLUGS[number];
export const isSection = (slug: string): slug is SectionSlug => (SECTION_SLUGS as readonly string[]).includes(slug);

interface SectionDef {
  icon: string;
  label: (t: ManagedUser) => string;
  /** One line under the label on phones. */
  description: (t: ManagedUser) => string;
  /** The current value, at the right on phones. */
  value: (t: ManagedUser) => string;
}

const SECTIONS: Record<SectionSlug, SectionDef> = {
  'lock': {
    icon: 'fa-solid fa-lock',
    label: (t) => (t.locked ? 'Unlock account' : 'Lock account'),
    description: (t) => (t.locked ? 'Let them log in again' : 'Stop them logging in'),
    value: (t) => (t.locked ? 'Locked' : 'Active'),
  },
  'reset-link': {
    icon: 'fa-regular fa-envelope',
    label: () => 'Password reset link',
    description: () => 'Email them a link to choose a new password',
    value: (t) => (t.email ? '' : 'No email'),
  },
  'password': {
    icon: 'fa-solid fa-key',
    label: () => 'Set password',
    description: () => 'Choose a password for them',
    value: () => '',
  },
  'email': {
    icon: 'fa-solid fa-at',
    label: () => 'Email address',
    description: () => 'Ask them to confirm a new address',
    value: (t) => t.email ?? 'Not set',
  },
  'email-status': {
    icon: 'fa-solid fa-envelope-circle-check',
    label: () => 'Email confirmed',
    description: () => 'Mark the address as confirmed or not',
    value: (t) => (!t.email ? '' : t.emailConfirmed ? 'Yes' : 'No'),
  },
  'end-sessions': {
    icon: 'fa-solid fa-right-from-bracket',
    label: () => 'Log out everywhere',
    description: () => 'End all their current logins',
    value: (t) => `${t.sessions} now`,
  },
  'disable-2fa': {
    icon: 'fa-solid fa-mobile-screen',
    label: () => 'Two-factor login',
    description: () => 'Turn it off, for a lost phone',
    value: (t) => (t.twoFactorEnabled ? 'On' : 'Off'),
  },
};

const baseOf = (target: ManagedUser) => `/admin/users/${target.id}`;

// ---- the frame ----

/** Without this the page would look like "My account"; the red frame says whose account is being changed. */
function Banner({ target }: { target: ManagedUser }) {
  return (
    <div class="alert alert-danger d-flex gap-2 align-items-start" role="note">
      <i class="fa-solid fa-user-shield mt-1" aria-hidden="true"></i>
      <div>
        <b>Admin area.</b> You are managing the account of <b>{target.username}</b>. Everything here changes <i>their</i> account,
        not yours. Each change asks you to type their user name first.
      </div>
    </div>
  );
}

function Overview({ target }: { target: ManagedUser }) {
  return (
    <dl class="row mb-0">
      <dt class="col-sm-4">User name</dt><dd class="col-sm-8">{target.username}</dd>
      <dt class="col-sm-4">Email</dt>
      <dd class="col-sm-8">
        {target.email ?? 'not set'}{' '}
        {target.email && (target.emailConfirmed
          ? <span class="badge text-bg-success">confirmed</span>
          : <span class="badge text-bg-warning">not confirmed</span>)}
      </dd>
      <dt class="col-sm-4">Status</dt>
      <dd class="col-sm-8">
        {target.locked ? <span class="badge text-bg-danger">Locked</span> : <span class="badge text-bg-success">Active</span>}
        {!target.approved && <>{' '}<span class="badge text-bg-warning">Not approved</span></>}
      </dd>
      <dt class="col-sm-4">Roles</dt><dd class="col-sm-8">{target.roles.join(', ') || 'none'}</dd>
      <dt class="col-sm-4">Two-factor login</dt><dd class="col-sm-8">{target.twoFactorEnabled ? 'on' : 'off'}</dd>
      <dt class="col-sm-4">Pilot groups</dt><dd class="col-sm-8">{target.groups}</dd>
      <dt class="col-sm-4">Logins now</dt><dd class="col-sm-8">{target.sessions}</dd>
      <dt class="col-sm-4">Member since</dt><dd class="col-sm-8">{formatTimestamp(target.createdAt)}</dd>
      <dt class="col-sm-4">Last login</dt><dd class="col-sm-8">{target.lastLoginAt ? formatTimestamp(target.lastLoginAt) : 'never'}</dd>
    </dl>
  );
}

/** The line over the list on phones, where the overview itself is not shown. */
function summaryOf(t: ManagedUser): string {
  return [t.locked ? 'Locked' : 'Active', t.roles.join(', '), `${t.groups} ${t.groups === 1 ? 'group' : 'groups'}`,
    t.lastLoginAt ? `last login ${formatTimestamp(t.lastLoginAt)}` : 'never logged in'].filter(Boolean).join(' · ');
}

/** The frame of every page of one user: the list of sections at the left (wide screens) or alone as the first screen (phones). */
function UserShell({ user, path, flash, target, section, children }: Common & { target: ManagedUser; section?: SectionSlug; children?: ComponentChildren }) {
  const index = !section;
  const own = target.id === user.id;
  const title = section ? `${SECTIONS[section].label(target)} - ${target.username}` : `User ${target.username}`;
  return (
    <Layout title={title} user={user} path={path} card="wide" scripts={section === 'email' || section === 'password' ? ['live-hints.js'] : undefined}>
      <p class="mb-2"><a href="/admin"><i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i> All users</a></p>
      <Alert flash={flash} />
      {own
        ? <div class="alert alert-info">This is your own account. Change it in <a href="/settings">Settings</a>; admins cannot lock or change themselves here.</div>
        : <Banner target={target} />}
      {own ? (
        <>
          <h1 class="h3 mb-3">{target.username}</h1>
          <Overview target={target} />
        </>
      ) : (
        <>
          {index && <p class="text-body-secondary d-md-none">{summaryOf(target)}</p>}
        <div class="ft-settings">
          <nav class={`ft-settings-nav${index ? '' : ' d-none d-md-block'}`} aria-label={`Manage ${target.username}`}>
            <section class="ft-settings-group">
              <h2 class="ft-settings-group-title">{target.username}</h2>
              <div class="list-group ft-settings-list">
                {SECTION_SLUGS.map((slug) => {
                  const def = SECTIONS[slug];
                  const value = def.value(target);
                  return (
                    <a class={`list-group-item list-group-item-action${section === slug ? ' active' : ''}`} href={`${baseOf(target)}/${slug}`}
                       aria-current={section === slug ? 'page' : undefined}>
                      <i class={`${def.icon} fa-fw ft-settings-icon`} aria-hidden="true"></i>
                      <span class="ft-settings-text">
                        <span class="ft-settings-label">{def.label(target)}</span>
                        <span class="ft-settings-desc d-md-none">{def.description(target)}</span>
                      </span>
                      {value && <span class="ft-settings-value d-md-none">{value}</span>}
                      <i class="fa-solid fa-chevron-right fa-xs ft-settings-chevron d-md-none" aria-hidden="true"></i>
                    </a>
                  );
                })}
              </div>
            </section>
          </nav>
          <div class={`ft-settings-pane${index ? ' d-none d-md-block' : ''}`}>
            {section ? (
              <>
                <a class="ft-settings-back d-md-none" href={baseOf(target)}><i class="fa-solid fa-chevron-left fa-xs" aria-hidden="true"></i> {target.username}</a>
                <h1 class="h3 mb-3">{SECTIONS[section].label(target)}</h1>
                {children}
              </>
            ) : <Overview target={target} />}
          </div>
        </div>
        </>
      )}
    </Layout>
  );
}

// ---- the pages ----

/** Wide screens: the list and the overview. Phones: the list alone, with a one-line summary above it. */
export function AdminUserIndexPage(props: Common & { target: ManagedUser }) {
  return <UserShell {...props} />;
}

/** The "type the user name" field that ends every change form. */
function ConfirmName({ slug, target, errors }: { slug: string; target: ManagedUser; errors: AdminErrors }) {
  const error = errors.form === slug ? errors.confirmName : undefined;
  const id = `confirm-${slug}`;
  return (
    <div class="mb-3">
      <label for={id} class="form-label">To confirm, type the user name <code>{target.username}</code></label>
      <input id={id} name="confirmName" type="text" class={`form-control${error ? ' is-invalid' : ''}`} required
             autocomplete="off" autocapitalize="off" spellcheck={false} aria-describedby={error ? `${id}-err` : undefined} />
      {error && <div id={`${id}-err`} class="invalid-feedback">{error}</div>}
    </div>
  );
}

/** The red frame round a change: what it does, then the form. */
function Change({ slug, errors, children }: { slug: string; errors: AdminErrors; children: ComponentChildren }) {
  return (
    <section class="card border-danger-subtle" id={slug}>
      <div class="card-body">
        {errors.form === slug && errors.general && <div class="alert alert-danger" role="alert">{errors.general}</div>}
        {children}
      </div>
    </section>
  );
}

const act = (target: ManagedUser, slug: string) => `${baseOf(target)}/${slug}`;

function SectionBody({ section, target, errors, values }: { section: SectionSlug; target: ManagedUser; errors: AdminErrors; values: Record<string, string | undefined> }) {
  const here = (slug: string, field: string) => (errors.form === slug ? errors[field] : undefined);
  switch (section) {
    case 'lock': {
      const slug = target.locked ? 'unlock' : 'lock'; // the form posts to /lock or /unlock
      const icon = target.locked ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock';
      return (
        <Change slug={slug} errors={errors}>
          <p>{target.locked
            ? <>{target.username} cannot log in now. Unlocking lets them in again.</>
            : <>A locked user cannot log in and is logged out at once. Their groups and maps stay as they are.</>}</p>
          <form method="post" action={act(target, slug)}>
            <ConfirmName slug={slug} target={target} errors={errors} />
            <Submit kind={target.locked ? 'success' : 'danger'} icon={icon}>{target.locked ? 'Unlock' : 'Lock'} {target.username}</Submit>
          </form>
        </Change>
      );
    }
    case 'reset-link':
      return (
        <Change slug="reset-link" errors={errors}>
          {target.email ? (
            <>
              <p>{target.username} gets the usual "choose a new password" email at <b>{target.email}</b>. You never see the new password.</p>
              <form method="post" action={act(target, 'reset-link')}>
                <ConfirmName slug="reset-link" target={target} errors={errors} />
                <Submit kind="danger" icon="fa-regular fa-paper-plane">Send link to {target.username}</Submit>
              </form>
            </>
          ) : <p class="mb-0">This user has no email address, so no link can be sent. Set a password instead.</p>}
        </Change>
      );
    case 'password':
      return (
        <Change slug="password" errors={errors}>
          <p>Takes effect at once and logs {target.username} out everywhere. You have to tell them the password yourself.</p>
          <form method="post" action={act(target, 'password')} class="ft-form" data-live-validate data-min-password={MIN_PASSWORD_LENGTH}
                data-forbidden={[target.username, target.email ?? ''].filter(Boolean).join(',')} novalidate>
            <Field name="password" label="New password" type="password" autocomplete="new-password" error={here('password', 'password')}
                   hints={<PasswordHints theirs />} />
            <Field name="confirmPassword" label="New password again" type="password" autocomplete="new-password" error={here('password', 'confirmPassword')}
                   hints={<ConfirmPasswordHints />} />
            <ConfirmName slug="password" target={target} errors={errors} />
            <Submit kind="danger" icon="fa-solid fa-key">Set password of {target.username}</Submit>
          </form>
        </Change>
      );
    case 'email':
      return (
        <Change slug="email" errors={errors}>
          <p>A confirmation link goes to the <i>new</i> address. The address changes when somebody opens it.</p>
          <form method="post" action={act(target, 'email')} class="ft-form" data-live-validate data-current-email={target.email ?? ''} novalidate>
            <div class="mb-3">
              <label for="current-email" class="form-label">Current email address</label>
              <input id="current-email" class="form-control" type="text" value={target.email ?? 'not set'} readonly />
              {target.email && !target.emailConfirmed && <div class="form-text">Not confirmed yet.</div>}
            </div>
            <Field name="email" label="New email address" type="email" autocomplete="off" value={errors.form === 'email' ? values.email : undefined}
                   error={here('email', 'email')} hints={<EmailHints different theirs />} />
            <ConfirmName slug="email" target={target} errors={errors} />
            <Submit kind="danger" icon="fa-regular fa-paper-plane">Ask {target.username} to confirm</Submit>
          </form>
        </Change>
      );
    case 'email-status':
      return (
        <Change slug="email-status" errors={errors}>
          {target.email ? (
            <>
              <p>{target.emailConfirmed
                ? <>Marks <b>{target.email}</b> as not confirmed; {target.username} can confirm it again by email.</>
                : <>Use this if the confirmation email never arrived but you know that <b>{target.email}</b> is right.</>}</p>
              <form method="post" action={act(target, 'email-status')}>
                <input type="hidden" name="to" value={target.emailConfirmed ? 'no' : 'yes'} />
                <ConfirmName slug="email-status" target={target} errors={errors} />
                <Submit kind="danger">{target.emailConfirmed ? 'Mark as not confirmed' : 'Mark as confirmed'}</Submit>
              </form>
            </>
          ) : <p class="mb-0">This user has no email address.</p>}
        </Change>
      );
    case 'end-sessions':
      return (
        <Change slug="end-sessions" errors={errors}>
          <p>Ends all logins of {target.username} ({target.sessions} right now). They can log in again.</p>
          <form method="post" action={act(target, 'end-sessions')}>
            <ConfirmName slug="end-sessions" target={target} errors={errors} />
            <Submit kind="danger" icon="fa-solid fa-right-from-bracket">Log out {target.username}</Submit>
          </form>
        </Change>
      );
    case 'disable-2fa':
      return (
        <Change slug="disable-2fa" errors={errors}>
          {target.twoFactorEnabled ? (
            <>
              <p>For a user who lost their phone and recovery codes. Their login is protected by the password alone until they set it up again.</p>
              <form method="post" action={act(target, 'disable-2fa')}>
                <ConfirmName slug="disable-2fa" target={target} errors={errors} />
                <Submit kind="danger" icon="fa-solid fa-mobile-screen">Turn off for {target.username}</Submit>
              </form>
            </>
          ) : <p class="mb-0">Two-factor login is not on for this user.</p>}
        </Change>
      );
  }
}

export function AdminUserSectionPage({ target, section, errors, values, ...c }: Common & {
  target: ManagedUser; section: SectionSlug; errors: AdminErrors; values: Record<string, string | undefined>;
}) {
  return (
    <UserShell target={target} section={section} {...c}>
      <SectionBody section={section} target={target} errors={errors} values={values} />
    </UserShell>
  );
}
