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

import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  /**
   * 'smtp' sends for real; 'log' (no SMTP_HOST configured) only writes the message to the server
   * log.
   */
  readonly kind: 'smtp' | 'log';
  send(message: MailMessage): Promise<void>;
}

interface Log {
  info(obj: object, msg: string): void;
}

export function createMailer(config: Config, log: Log): Mailer {
  const from = config.MAIL_FROM_ADDRESS
    ? { name: config.MAIL_FROM_NAME, address: config.MAIL_FROM_ADDRESS }
    : { name: config.MAIL_FROM_NAME, address: 'noreply@localhost' };

  if (!config.SMTP_HOST)
    return {
      kind: 'log',
      async send(message) {
        log.info(
          { to: message.to, subject: message.subject },
          `Email (SMTP is not configured, not sent):\n${message.text}`,
        );
      },
    };

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? (config.SMTP_SECURE ? 465 : 587),
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    kind: 'smtp',
    async send(message) {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
  };
}
