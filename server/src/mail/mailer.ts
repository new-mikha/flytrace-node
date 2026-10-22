import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export interface MailMessage { to: string; subject: string; html: string; text: string }

export interface Mailer {
  /** 'smtp' sends for real; 'log' (no SMTP_HOST configured) only writes the message to the server log. */
  readonly kind: 'smtp' | 'log';
  send(message: MailMessage): Promise<void>;
}

interface Log { info(obj: object, msg: string): void }

export function createMailer(config: Config, log: Log): Mailer {
  const from = config.MAIL_FROM_ADDRESS
    ? { name: config.MAIL_FROM_NAME, address: config.MAIL_FROM_ADDRESS }
    : { name: config.MAIL_FROM_NAME, address: 'noreply@localhost' };

  if (!config.SMTP_HOST) {
    return {
      kind: 'log',
      async send(message) {
        log.info({ to: message.to, subject: message.subject }, `Email (SMTP is not configured, not sent):\n${message.text}`);
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? (config.SMTP_SECURE ? 465 : 587),
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    kind: 'smtp',
    async send(message) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, html: message.html, text: message.text });
    },
  };
}
