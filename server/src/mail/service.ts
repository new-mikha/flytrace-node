import { baseUrl, type Config } from '../config.ts';
import type { Pool } from '../db.ts';
import { createToken } from '../auth/tokens.ts';
import { maskEmail } from '../audit.ts';
import type { Mailer } from './mailer.ts';
import * as templates from './templates.ts';

interface Log { info(obj: object, msg: string): void; error(obj: object, msg: string): void }

export interface Recipient { id: string; username: string; email: string }

/** The emails the site sends, with their links. Sending never throws: callers get true/false and the failure is logged. */
export class MailService {
  private readonly ctx: templates.MailContext;

  constructor(
    private readonly config: Config,
    private readonly pool: Pool,
    readonly mailer: Mailer,
    private readonly log: Log,
  ) {
    this.ctx = { siteName: 'Flytrace', siteUrl: baseUrl(config), contactAddress: config.MAIL_CONTACT_ADDRESS };
  }

  get canDeliver(): boolean { return this.mailer.kind === 'smtp'; }

  private readonly running = new Set<Promise<unknown>>();

  /**
   * Runs a send in the background so the page does not wait for the mail server. Besides being faster, this keeps
   * "forgot password" from answering slower for real accounts than for unknown names.
   */
  queue(task: () => Promise<unknown>): void {
    const run = task().catch((err: unknown) => this.log.error({ err }, 'Background email task failed'))
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  /** Waits for queued sends (server shutdown, tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.running]);
  }

  private link(path: string, token: string): string {
    return `${this.ctx.siteUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  /** Sends and reports. `error` carries the transport's message, for the test-email page. */
  private async deliver(to: string, username: string, message: Omit<Parameters<Mailer['send']>[0], 'to'>): Promise<{ ok: boolean; error?: string }> {
    const masked = maskEmail(to);
    try {
      await this.mailer.send({ to, ...message });
      this.log.info({ event: 'email.sent', user: username, to: masked, subject: message.subject },
        `Email "${message.subject}" sent to ${masked}`);
      return { ok: true };
    } catch (err) {
      this.log.error({ event: 'email.failed', err, user: username, to: masked, subject: message.subject },
        `Sending email "${message.subject}" to ${masked} failed`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendConfirmEmail(to: Recipient) {
    const token = await createToken(this.pool, to.id, 'confirm_email');
    return this.deliver(to.email, to.username, templates.confirmEmailMessage(this.ctx, to.username, this.link('/confirm-email', token)));
  }

  async sendResetPassword(to: Recipient) {
    const token = await createToken(this.pool, to.id, 'reset_password');
    return this.deliver(to.email, to.username, templates.resetPasswordMessage(this.ctx, to.username, this.link('/reset-password', token)));
  }

  async sendChangeEmail(to: Recipient, newEmail: string) {
    const token = await createToken(this.pool, to.id, 'change_email', newEmail);
    return this.deliver(newEmail, to.username, templates.changeEmailMessage(this.ctx, to.username, this.link('/confirm-email-change', token)));
  }

  sendTest(to: Recipient) {
    return this.deliver(to.email, to.username, templates.testMessage(this.ctx, to.username));
  }

  sendPasswordChanged(to: Recipient) {
    return this.deliver(to.email, to.username, templates.passwordChangedMessage(this.ctx, to.username));
  }
}
