///////////////////////////////////////////////////////////////////////////////
//  Flytrace, online viewer for GPS trackers.
//  Copyright (C) 2011-2026 Mikhail Karmazin
//
//  This file is part of Flytrace.
//
//  Flytrace is free software: you can redistribute it and/or modify
//  it under the terms of the GNU Affero General Public License as
//  published by the Free Software Foundation, either version 3 of the
//  License, or (at your option) any later version.
//
//  Flytrace is distributed in the hope that it will be useful,
//  but WITHOUT ANY WARRANTY; without even the implied warranty of
//  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  GNU Affero General Public License for more details.
//
//  You should have received a copy of the GNU Affero General Public License
//  along with Flytrace.  If not, see <http://www.gnu.org/licenses/>.
///////////////////////////////////////////////////////////////////////////////

import type { ComponentChildren } from 'preact';
import { MIN_PASSWORD_LENGTH, type Account } from '../auth/accounts.ts';
import type { CurrentUser } from '../auth/service.ts';
import { formatTimestamp } from './format.ts';
import { SettingsShell } from './SettingsShell.tsx';
import { Alert, ConfirmPasswordHints, EmailHints, Field, PasswordHints, Submit, type Flash } from './forms.tsx';

interface Common { user: CurrentUser; path: string; flash?: Flash | null }
type Errors = Record<string, string | undefined>;

/** The signed-in account pages: part of the settings (see SettingsShell), reached from "Settings" in the top bar. */
function AccountShell({ title, user, path, flash, children, scripts }: Common & { title: string; children: ComponentChildren; scripts?: string[] }) {
  return (
    <SettingsShell title={title} user={user} path={path} flash={flash} scripts={scripts}>
      {children}
    </SettingsShell>
  );
}

function PasswordConfirm({ error }: { error?: string }) {
  return <Field name="currentPassword" label="Your current password" type="password" autocomplete="current-password" error={error} />;
}

function EmailStatus({ account }: { account: Account }) {
  if (!account.email) return <span class="badge text-bg-secondary">none</span>;
  return account.emailConfirmed
    ? <span class="badge text-bg-success"><i class="fa-solid fa-check" aria-hidden="true"></i> confirmed</span>
    : <span class="badge text-bg-warning">not confirmed</span>;
}

// ---- profile ----

export function ProfilePage({ account, mailKind, ...c }: Common & { account: Account; mailKind: 'smtp' | 'log' }) {
  return (
    <AccountShell title="Profile" {...c}>
      <dl class="row mb-4">
        <dt class="col-sm-4">Username</dt><dd class="col-sm-8">{account.username}</dd>
        <dt class="col-sm-4">Email</dt>
        <dd class="col-sm-8">{account.email ?? 'not set'} <EmailStatus account={account} />
          {' '}<a href="/account/email" class="small">change</a></dd>
        <dt class="col-sm-4">Member since</dt><dd class="col-sm-8">{formatTimestamp(account.createdAt)}</dd>
        <dt class="col-sm-4">Last login</dt><dd class="col-sm-8">{account.lastLoginAt ? formatTimestamp(account.lastLoginAt) : 'this is the first'}</dd>
        <dt class="col-sm-4">Two-factor login</dt>
        <dd class="col-sm-8">{account.twoFactorEnabled ? 'on' : 'off'} <a href="/account/2fa" class="small">manage</a></dd>
      </dl>

      {account.email && (
        <div class="d-flex flex-wrap gap-2">
          {!account.emailConfirmed && (
            <form method="post" action="/account/resend-confirmation">
              <Submit kind="warning" icon="fa-regular fa-paper-plane">Send confirmation email</Submit>
            </form>
          )}
          <form method="post" action="/account/test-email">
            <Submit kind="outline-primary" icon="fa-regular fa-envelope">Send a test email to me</Submit>
          </form>
        </div>
      )}
      {mailKind === 'log' && (
        <p class="form-text mt-2">Outgoing email is not set up on this server, so messages are only written to the server log.</p>
      )}
    </AccountShell>
  );
}

// ---- email ----

export function EmailPage({ account, errors, value, ...c }: Common & { account: Account; errors: Errors; value?: string }) {
  return (
    <AccountShell title="Email" scripts={['live-hints.js']} {...c}>
      <p>Current address: <strong>{account.email ?? 'none'}</strong> <EmailStatus account={account} /></p>
      <form method="post" action="/account/email" class="ft-form" data-live-validate data-current-email={account.email ?? ''} novalidate>
        <Field name="email" label="New email" type="email" value={value ?? account.email ?? undefined} error={errors.email} autocomplete="email"
               help="We send a link to the new address; it replaces the current one once you open it."
               hints={<EmailHints different />} />
        <PasswordConfirm error={errors.currentPassword} />
        <Submit icon="fa-regular fa-paper-plane">Send confirmation link</Submit>
      </form>
    </AccountShell>
  );
}

// ---- password ----

export function PasswordPage({ account, errors, ...c }: Common & { account: Account; errors: Errors }) {
  return (
    <AccountShell title="Change password" scripts={['live-hints.js']} {...c}>
      <form method="post" action="/account/password" class="ft-form" data-live-validate data-min-password={MIN_PASSWORD_LENGTH}
            data-forbidden={[account.username, account.email ?? ''].filter(Boolean).join(',')} novalidate>
        <PasswordConfirm error={errors.currentPassword} />
        <Field name="password" label="New password" type="password" error={errors.password} autocomplete="new-password"
               hints={<PasswordHints />} />
        <Field name="confirmPassword" label="Confirm new password" type="password" error={errors.confirmPassword} autocomplete="new-password"
               hints={<ConfirmPasswordHints />} />
        <Submit>Change password</Submit>
        <p class="form-text mt-2">Other devices that are logged in will be logged out.</p>
      </form>
    </AccountShell>
  );
}

// ---- two-factor ----

export function TwoFactorPage({ account, recoveryLeft, errors, ...c }: Common & { account: Account; recoveryLeft: number; errors: Errors }) {
  if (!account.twoFactorEnabled) {
    return (
      <AccountShell title="Two-factor login" {...c}>
        <p>Two-factor login is <strong>off</strong>. When it is on, logging in also needs a 6-digit code from an
          authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Aegis, 1Password, ...),
          so a stolen password alone is not enough.</p>
        <a class="btn btn-primary" href="/account/2fa/setup"><i class="fa-solid fa-shield-halved fa-fw" aria-hidden="true"></i> Set up authenticator app</a>
      </AccountShell>
    );
  }
  return (
    <AccountShell title="Two-factor login" {...c}>
      <p><span class="badge text-bg-success">on</span> Logging in needs a code from your authenticator app.</p>
      <p>Recovery codes left: <strong>{recoveryLeft}</strong>{recoveryLeft <= 3 && <span class="text-danger"> &ndash; make new ones soon</span>}</p>

      <div class="card mb-3"><div class="card-body">
        <h3 class="h6">New recovery codes</h3>
        <p class="small mb-2">Replaces all your current codes. Needed when you lose your phone.</p>
        <form method="post" action="/account/2fa/recovery-codes" class="ft-form" novalidate>
          <Field name="currentPassword" label="Your current password" type="password" autocomplete="current-password" error={errors.recovery} />
          <Submit kind="outline-primary" icon="fa-solid fa-life-ring">Generate new codes</Submit>
        </form>
      </div></div>

      <div class="card mb-3"><div class="card-body">
        <h3 class="h6">Change phone or authenticator app</h3>
        <p class="small mb-2">Sets up a new app; the old one stops working as soon as you confirm the new one.</p>
        <a class="btn btn-outline-primary" href="/account/2fa/setup"><i class="fa-solid fa-rotate fa-fw" aria-hidden="true"></i> Reset authenticator app</a>
      </div></div>

      <div class="card border-danger"><div class="card-body">
        <h3 class="h6 text-danger">Turn off two-factor login</h3>
        <form method="post" action="/account/2fa/disable" class="ft-form" novalidate>
          <Field name="currentPassword" label="Your current password" type="password" autocomplete="current-password" error={errors.disable} />
          <Submit kind="danger" icon="fa-solid fa-shield-halved">Turn off</Submit>
        </form>
      </div></div>
    </AccountShell>
  );
}

export function TwoFactorSetupPage({ secret, qrSvg, error, ...c }: Common & { secret: string; qrSvg: string; error?: string }) {
  const spaced = secret.match(/.{1,4}/g)?.join(' ') ?? secret;
  return (
    <AccountShell title="Set up authenticator app" {...c}>
      <ol>
        <li>Install an authenticator app on your phone if you do not have one yet.</li>
        <li>Scan this QR code with it, or type the key in by hand.</li>
      </ol>
      {/* SVG generated by the qrcode library from our own otpauth:// address; contains no user-typed text. */}
      <div class="ft-qr mb-2" role="img" aria-label="QR code for the authenticator app" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      <p class="mb-3">Key: <code class="user-select-all">{spaced}</code></p>
      <ol start={3}><li>Enter the 6-digit code the app shows now.</li></ol>
      <form method="post" action="/account/2fa/setup" class="ft-form" novalidate>
        <Field name="code" label="Code from the app" autocomplete="one-time-code" inputmode="numeric" maxlength={9} autofocus error={error} />
        <Submit>Verify and turn on</Submit>
        {' '}<a class="btn btn-link" href="/account/2fa">Cancel</a>
      </form>
    </AccountShell>
  );
}

export function RecoveryCodesPage({ codes, firstTime, ...c }: Common & { codes: string[]; firstTime: boolean }) {
  return (
    <AccountShell title="Recovery codes" {...c}>
      {firstTime && <Alert flash={{ kind: 'success', text: 'Two-factor login is on.' }} />}
      <p>Keep these codes somewhere safe, such as a password manager or a printout. Each one works once if you
        cannot use your authenticator app. <strong>They are shown only now.</strong></p>
      <ul class="ft-codes list-unstyled">
        {codes.map((code) => <li><code>{code}</code></li>)}
      </ul>
      <a class="btn btn-primary" href="/account/2fa">I have saved them</a>
    </AccountShell>
  );
}

// ---- personal data ----

export function PersonalDataPage({ errors, ...c }: Common & { errors: Errors }) {
  return (
    <AccountShell title="Personal data" {...c}>
      <p>Download everything Flytrace holds about your account (profile, events, groups and their trackers) as a JSON file.</p>
      <p><a class="btn btn-outline-primary" href="/account/personal-data/download" download="flytrace-data.json">
        <i class="fa-solid fa-download fa-fw" aria-hidden="true"></i> Download my data</a></p>

      <div class="card border-danger mt-4"><div class="card-body">
        <h3 class="h6 text-danger">Delete my account</h3>
        <p class="small">This permanently deletes your account, your groups, events and trackers. It cannot be undone.</p>
        <form method="post" action="/account/delete" class="ft-form" novalidate>
          <Field name="currentPassword" label="Your current password" type="password" autocomplete="current-password" error={errors.currentPassword} />
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" name="confirm" id="f-confirm" value="yes" required />
            <label class="form-check-label" for="f-confirm">Yes, delete my account and all its data</label>
            {errors.confirm && <div class="text-danger small">{errors.confirm}</div>}
          </div>
          <Submit kind="danger" icon="fa-solid fa-trash">Delete my account</Submit>
        </form>
      </div></div>
    </AccountShell>
  );
}
