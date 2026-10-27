import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import type { AdminUserRow, ManagedUser } from '../repo/adminUsers.ts';
import { formatTimestamp } from './format.ts';
import { Alert, Field, Submit, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';

interface Common { user: CurrentUser; path: string; flash?: Flash | null }

/** `form` names the change that failed (its slug), so that only that form shows the messages. */
export type AdminErrors = Record<string, string | undefined>;

// ---- the list ----

function pageHref(q: string, pageNo: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (pageNo > 1) params.set('page', String(pageNo));
  const query = params.toString();
  return query ? `/admin?${query}` : '/admin';
}

function UserRow({ u }: { u: AdminUserRow }) {
  return (
    <tr>
      <td class="fw-semibold ft-name-cell ft-card-full">
        {u.username} {u.locked && <span class="badge text-bg-danger">Locked</span>}
      </td>
      <td class="ft-card-full text-body-secondary">{u.email}</td>
      <td class="ft-card-stat" data-label="Roles">{u.roles.join(', ') || '-'}</td>
      <td class="text-end ft-card-stat" data-label="Groups">{u.groups}</td>
      <td class="text-nowrap ft-card-full">{u.lastLoginAt ? formatTimestamp(u.lastLoginAt) : <span class="text-body-secondary">never</span>}</td>
      <td class="text-end text-nowrap ft-card-link ft-actions">
        <a class="ft-group-link" href={`/admin/users/${u.id}`}>Manage</a>
      </td>
    </tr>
  );
}

export function AdminUsersPage({ user, path, flash, q, users, total, pageNo, pageSize }: Common & {
  q: string; users: AdminUserRow[]; total: number; pageNo: number; pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Layout title="Users" user={user} path={path} card="wide">
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> Users</h5>
        <Alert flash={flash} />
        <form method="get" action="/admin" class="d-flex gap-2 mb-3" role="search">
          <input class="form-control" type="search" name="q" value={q} maxlength={100} placeholder="Part of a user name or email" aria-label="Search users" />
          <button class="btn btn-primary" type="submit">Search</button>
          {q && <a class="btn btn-outline-secondary" href="/admin">Clear</a>}
        </form>
        <p class="text-body-secondary">{total} {total === 1 ? 'user' : 'users'}{q && <> matching <b>{q}</b></>}</p>
        {users.length > 0 && (
          <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
            <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
              <caption class="visually-hidden">Users</caption>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  <th scope="col">Email</th>
                  <th scope="col">Roles</th>
                  <th scope="col" class="text-end">Groups</th>
                  <th scope="col">Last login</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>{users.map((u) => <UserRow key={u.id} u={u} />)}</tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav class="d-flex justify-content-between align-items-center mt-3" aria-label="Pages">
            {pageNo > 1 ? <a class="btn btn-outline-secondary" href={pageHref(q, pageNo - 1)}>Previous</a> : <span></span>}
            <span class="text-body-secondary">Page {pageNo} of {pages}</span>
            {pageNo < pages ? <a class="btn btn-outline-secondary" href={pageHref(q, pageNo + 1)}>Next</a> : <span></span>}
          </nav>
        )}
      </section>
    </Layout>
  );
}

// ---- one user ----

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
    <dl class="row mb-4">
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

function Section({ slug, title, icon, errors, children }: { slug: string; title: string; icon: string; errors: AdminErrors; children: ComponentChildren }) {
  return (
    <section class="card border-danger-subtle mb-3" id={slug}>
      <div class="card-header"><i class={`${icon} fa-fw text-danger`} aria-hidden="true"></i> <b>{title}</b></div>
      <div class="card-body">
        {errors.form === slug && errors.general && <div class="alert alert-danger" role="alert">{errors.general}</div>}
        {children}
      </div>
    </section>
  );
}

const act = (target: ManagedUser, slug: string) => `/admin/users/${target.id}/${slug}`;

export function AdminUserPage({ user, path, flash, target, errors, values }: Common & {
  target: ManagedUser; errors: AdminErrors; values: Record<string, string | undefined>;
}) {
  const own = target.id === user.id;
  const here = (slug: string, field: string) => (errors.form === slug ? errors[field] : undefined);
  const lockSlug = target.locked ? 'unlock' : 'lock';
  return (
    <Layout title={`User ${target.username}`} user={user} path={path} card="medium">
      <p class="mb-2"><a href="/admin"><i class="fa-solid fa-arrow-left fa-xs" aria-hidden="true"></i> All users</a></p>
      <Alert flash={flash} />
      {own ? (
        <div class="alert alert-info">This is your own account. Change it in <a href="/settings">Settings</a>; admins cannot lock or change themselves here.</div>
      ) : <Banner target={target} />}
      <h1 class="h3 mb-3">{target.username}</h1>
      <Overview target={target} />
      {!own && (
        <>
          <Section slug={lockSlug} title={target.locked ? 'Unlock' : 'Lock'} icon={target.locked ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'} errors={errors}>
            <p>{target.locked
              ? <>{target.username} cannot log in now. Unlocking lets them in again.</>
              : <>A locked user cannot log in and is logged out at once. Their groups and maps stay as they are.</>}</p>
            <form method="post" action={act(target, lockSlug)}>
              <ConfirmName slug={lockSlug} target={target} errors={errors} />
              <Submit kind={target.locked ? 'success' : 'danger'} icon={target.locked ? 'fa-solid fa-lock-open' : 'fa-solid fa-lock'}>
                {target.locked ? 'Unlock' : 'Lock'} {target.username}
              </Submit>
            </form>
          </Section>

          <Section slug="reset-link" title="Send a password reset link" icon="fa-regular fa-envelope" errors={errors}>
            <p>{target.email
              ? <>{target.username} gets the usual "choose a new password" email at <b>{target.email}</b>. You never see the new password.</>
              : <>This user has no email address, so no link can be sent. Set a password below instead.</>}</p>
            {target.email && (
              <form method="post" action={act(target, 'reset-link')}>
                <ConfirmName slug="reset-link" target={target} errors={errors} />
                <Submit kind="danger" icon="fa-regular fa-paper-plane">Send link to {target.username}</Submit>
              </form>
            )}
          </Section>

          <Section slug="password" title="Set a new password" icon="fa-solid fa-key" errors={errors}>
            <p>Takes effect at once and logs {target.username} out everywhere. You have to tell them the password yourself.</p>
            <form method="post" action={act(target, 'password')}>
              <Field name="password" label="New password" type="password" autocomplete="new-password" error={here('password', 'password')} />
              <Field name="confirmPassword" label="New password again" type="password" autocomplete="new-password" error={here('password', 'confirmPassword')} />
              <ConfirmName slug="password" target={target} errors={errors} />
              <Submit kind="danger" icon="fa-solid fa-key">Set password of {target.username}</Submit>
            </form>
          </Section>

          <Section slug="email" title="Change the email address" icon="fa-solid fa-at" errors={errors}>
            <p>A confirmation link goes to the <i>new</i> address. The address changes when somebody opens it.</p>
            <form method="post" action={act(target, 'email')}>
              <Field name="email" label="New email address" type="email" autocomplete="off" value={errors.form === 'email' ? values.email : undefined}
                     error={here('email', 'email')} />
              <ConfirmName slug="email" target={target} errors={errors} />
              <Submit kind="danger" icon="fa-regular fa-paper-plane">Ask {target.username} to confirm</Submit>
            </form>
          </Section>

          {target.email && (
            <Section slug="email-status" title={target.emailConfirmed ? 'Mark the email as not confirmed' : 'Mark the email as confirmed'}
                     icon="fa-solid fa-envelope-circle-check" errors={errors}>
              <p>{target.emailConfirmed
                ? <>Marks <b>{target.email}</b> as not confirmed; {target.username} can confirm it again by email.</>
                : <>Use this if the confirmation email never arrived but you know that <b>{target.email}</b> is right.</>}</p>
              <form method="post" action={act(target, 'email-status')}>
                <input type="hidden" name="to" value={target.emailConfirmed ? 'no' : 'yes'} />
                <ConfirmName slug="email-status" target={target} errors={errors} />
                <Submit kind="danger">{target.emailConfirmed ? 'Mark as not confirmed' : 'Mark as confirmed'}</Submit>
              </form>
            </Section>
          )}

          <Section slug="end-sessions" title="Log out everywhere" icon="fa-solid fa-right-from-bracket" errors={errors}>
            <p>Ends all logins of {target.username} ({target.sessions} right now). They can log in again.</p>
            <form method="post" action={act(target, 'end-sessions')}>
              <ConfirmName slug="end-sessions" target={target} errors={errors} />
              <Submit kind="danger" icon="fa-solid fa-right-from-bracket">Log out {target.username}</Submit>
            </form>
          </Section>

          {target.twoFactorEnabled && (
            <Section slug="disable-2fa" title="Turn off two-factor login" icon="fa-solid fa-mobile-screen" errors={errors}>
              <p>For a user who lost their phone and recovery codes. Their login is protected by the password alone until they set it up again.</p>
              <form method="post" action={act(target, 'disable-2fa')}>
                <ConfirmName slug="disable-2fa" target={target} errors={errors} />
                <Submit kind="danger" icon="fa-solid fa-mobile-screen">Turn off for {target.username}</Submit>
              </form>
            </Section>
          )}
        </>
      )}
    </Layout>
  );
}
