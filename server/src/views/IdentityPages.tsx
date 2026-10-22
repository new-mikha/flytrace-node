import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import { Layout } from './Layout.tsx';
import { Alert, Card, Field, Submit, type Flash } from './forms.tsx';

interface Common { user: CurrentUser | null; path: string; flash?: Flash | null }
type Errors = Record<string, string | undefined>;

function Shell({ title, icon, user, path, flash, children, wide }: Common & { title: string; icon?: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <Layout title={title} user={user} path={path} card>
      <Card title={title} icon={icon} wide={wide}>
        <Alert flash={flash} />
        {children}
      </Card>
    </Layout>
  );
}

// ---- log in ----

export function LoginPage({ returnUrl, error, ...c }: Common & { returnUrl: string; error?: 'invalid' | 'unconfirmed' | 'locked' | 'expired' }) {
  return (
    <Shell title="Log in" icon="fa-solid fa-right-to-bracket" {...c}>
      {error === 'invalid' && <Alert flash={{ kind: 'danger', text: 'Invalid username or password.' }} />}
      {error === 'locked' && <Alert flash={{ kind: 'danger', text: 'Too many wrong codes. Please log in again.' }} />}
      {error === 'expired' && <Alert flash={{ kind: 'info', text: 'That login took too long. Please log in again.' }} />}
      {error === 'unconfirmed' && (
        <Alert flash={{ kind: 'danger', text: 'Please confirm your email address first: open the link in the email we sent you.' }} />
      )}
      {error === 'unconfirmed' && <p><a href="/resend-confirmation">Send the confirmation email again</a></p>}
      <form method="post" action="/login">
        <input type="hidden" name="returnUrl" value={returnUrl} />
        <Field name="username" label="Username or email" autocomplete="username" autofocus />
        <Field name="password" label="Password" type="password" autocomplete="current-password" />
        <Submit icon="fa-solid fa-right-to-bracket">Log in</Submit>
      </form>
      <hr />
      <p class="mb-1"><a href="/forgot-password">Forgot your password?</a></p>
      <p class="mb-0">No account yet? <a href="/register">Register</a></p>
    </Shell>
  );
}

export function TwoFactorLoginPage({ error, ...c }: Common & { error?: boolean }) {
  return (
    <Shell title="Two-factor login" icon="fa-solid fa-shield-halved" {...c}>
      <p>Open your authenticator app and enter the 6-digit code for FlyTrace.</p>
      <form method="post" action="/login/2fa">
        <Field name="code" label="Authenticator code" autocomplete="one-time-code" inputmode="numeric" maxlength={9}
               autofocus error={error ? 'That code is not right. Try the current one.' : undefined} />
        <Submit icon="fa-solid fa-check">Verify</Submit>
      </form>
      <hr />
      <p class="mb-1">Lost your phone? <a href="/login/recovery">Use a recovery code</a></p>
      <p class="mb-0"><a href="/login">Start over</a></p>
    </Shell>
  );
}

export function RecoveryLoginPage({ error, ...c }: Common & { error?: boolean }) {
  return (
    <Shell title="Recovery code" icon="fa-solid fa-life-ring" {...c}>
      <p>Enter one of the recovery codes you saved when you turned on two-factor login. Each code works once.</p>
      <form method="post" action="/login/recovery">
        <Field name="code" label="Recovery code" autocomplete="off" autofocus maxlength={20}
               error={error ? 'That recovery code is not valid or was already used.' : undefined} />
        <Submit icon="fa-solid fa-check">Log in</Submit>
      </form>
      <hr />
      <p class="mb-0"><a href="/login/2fa">Use the authenticator app instead</a></p>
    </Shell>
  );
}

// ---- register ----

export interface RegisterValues { username?: string; email?: string }

export function RegisterPage({ values, errors, ...c }: Common & { values: RegisterValues; errors: Errors }) {
  return (
    <Shell title="Register" icon="fa-solid fa-user-plus" {...c}>
      <form method="post" action="/register" novalidate>
        <Field name="username" label="Username" value={values.username} error={errors.username} autocomplete="username"
               help="3 to 64 letters, digits, dots, dashes or underscores." autofocus />
        <Field name="email" label="Email" type="email" value={values.email} error={errors.email} autocomplete="email"
               help="We send a confirmation link here. You can also log in with it." />
        <Field name="password" label="Password" type="password" error={errors.password} autocomplete="new-password"
               help="At least 8 characters." />
        <Field name="confirmPassword" label="Confirm password" type="password" error={errors.confirmPassword} autocomplete="new-password" />
        <Submit icon="fa-solid fa-user-plus">Register</Submit>
      </form>
      <hr />
      <p class="mb-0">Already registered? <a href="/login">Log in</a></p>
    </Shell>
  );
}

export function CheckEmailPage({ email, emailSent, ...c }: Common & { email: string; emailSent: boolean }) {
  return (
    <Shell title="Check your email" icon="fa-regular fa-envelope" {...c}>
      <p>Thank you for registering! We sent a confirmation link to <strong>{email}</strong>.
        Open it to activate your account, then log in.</p>
      {!emailSent && <p class="text-muted">This server has no outgoing email set up, so nothing was sent. The administrator can find the link in the server log.</p>}
      <p class="mb-0">Nothing arrived? Check the spam folder, or <a href="/resend-confirmation">send it again</a>.</p>
    </Shell>
  );
}

// ---- one-time links ----

/**
 * What a emailed link opens: a page with a button, so that mail scanners following the link do not use it up.
 * The token is only spent when the button (a POST) is pressed.
 */
export function LinkPage({ title, icon, action, token, valid, intro, button, ...c }: Common & {
  title: string; icon: string; action: string; token: string; valid: boolean; intro: ComponentChildren; button: string;
}) {
  return (
    <Shell title={title} icon={icon} {...c}>
      {valid ? (
        <>
          <p>{intro}</p>
          <form method="post" action={action}>
            <input type="hidden" name="token" value={token} />
            <Submit icon="fa-solid fa-check">{button}</Submit>
          </form>
        </>
      ) : (
        <>
          <Alert flash={{ kind: 'danger', text: 'This link is not valid any more. It may have expired or been used already.' }} />
          <p class="mb-0"><a href="/login">Log in</a>, or <a href="/forgot-password">get a new password link</a>.</p>
        </>
      )}
    </Shell>
  );
}

export function MessagePage({ title, icon, children, ...c }: Common & { title: string; icon?: string; children: ComponentChildren }) {
  return <Shell title={title} icon={icon} {...c}>{children}</Shell>;
}

// ---- forgot / reset password ----

export function ForgotPasswordPage({ error, ...c }: Common & { error?: string }) {
  return (
    <Shell title="Forgot your password?" icon="fa-solid fa-key" {...c}>
      <p>Enter your username or email and we will email you a link to choose a new password.</p>
      <form method="post" action="/forgot-password">
        <Field name="login" label="Username or email" autocomplete="username" autofocus error={error} />
        <Submit icon="fa-regular fa-paper-plane">Send the link</Submit>
      </form>
      <hr />
      <p class="mb-0"><a href="/login">Back to log in</a></p>
    </Shell>
  );
}

export function ResetPasswordPage({ token, valid, errors, ...c }: Common & { token: string; valid: boolean; errors: Errors }) {
  return (
    <Shell title="Choose a new password" icon="fa-solid fa-key" {...c}>
      {valid ? (
        <form method="post" action="/reset-password" novalidate>
          <input type="hidden" name="token" value={token} />
          <Field name="password" label="New password" type="password" error={errors.password} autocomplete="new-password"
                 help="At least 8 characters." autofocus />
          <Field name="confirmPassword" label="Confirm new password" type="password" error={errors.confirmPassword} autocomplete="new-password" />
          <Submit icon="fa-solid fa-check">Change password</Submit>
        </form>
      ) : (
        <>
          <Alert flash={{ kind: 'danger', text: 'This link is not valid any more. It may have expired or been used already.' }} />
          <p class="mb-0"><a href="/forgot-password">Get a new link</a></p>
        </>
      )}
    </Shell>
  );
}

export function ResendConfirmationPage({ error, ...c }: Common & { error?: string }) {
  return (
    <Shell title="Resend confirmation email" icon="fa-regular fa-envelope" {...c}>
      <p>Enter your username or email and we will send the confirmation link again.</p>
      <form method="post" action="/resend-confirmation">
        <Field name="login" label="Username or email" autocomplete="username" autofocus error={error} />
        <Submit icon="fa-regular fa-paper-plane">Send</Submit>
      </form>
    </Shell>
  );
}
