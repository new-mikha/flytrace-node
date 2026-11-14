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

// Emails to the site's owners (ALERT_EMAILS), apart from the log levels: `sendNow` for what they want
// to hear of each time (a new account, an email sent to somebody), `throttle` for what may come by
// the hundred (feed failures, crashes), as counted summaries. Everything is kept in memory.
import { maskEmail } from '../audit.ts';
import type { Mailer } from '../mail/mailer.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The summary windows of a type, one after the other whether they had messages or not. */
export const WINDOWS_MS = [MINUTE, 10 * MINUTE, HOUR, DAY];
/** A type is forgotten after this long without a message; its next one starts at 1 minute again. */
export const FORGET_AFTER_MS = 6 * HOUR;
/** `sendNow` emails at most this many in any 24 hours; the rest go to `throttle('send-now')`. */
export const SEND_NOW_PER_DAY = 10;
/** How long `flush` waits for the last emails at shutdown. */
export const FLUSH_TIMEOUT_MS = 5000;

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/** A type being throttled: what its current window holds, and its timers. */
interface Throttled {
  window: number;
  since: number;
  count: number;
  first: string | null;
  windowTimer?: NodeJS.Timeout;
  forgetTimer?: NodeJS.Timeout;
}

/** What the callers use; `noAlerts` for those that have none (tests). */
export type Alerts = Pick<EmailLogger, 'sendNow' | 'throttle'>;
export const noAlerts: Alerts = { sendNow: () => {}, throttle: () => {} };

const timer = (ms: number, action: () => void) => setTimeout(action, ms).unref();

/** Email addresses in a message, masked in the log lines as everywhere in the log. */
const EMAIL = /[^\s,;:"'<>()]+@[^\s,;:"'<>()]+\.[^\s,;:"'<>()]+/g;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "40 seconds", "10 minutes", "6 hours". */
function duration(ms: number): string {
  if (ms < 2 * MINUTE) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 2 * HOUR) return `${Math.round(ms / MINUTE)} minutes`;
  return `${Math.round(ms / HOUR)} hours`;
}

/**
 * Every call is also a WARN in the log (with an `alert` field) and a line in `email-logger.<date>.log`
 * (`file`, when LOG_DIR is set), email addresses masked there; the emails have them in full. Nothing is emailed without recipients or without SMTP. The emails go
 * to the mailer itself, never through `MailService`, whose every email calls `sendNow`. Never put a
 * password in a message, nor the text of an email to somebody (its links are as good as one).
 */
export class EmailLogger {
  private readonly types = new Map<string, Throttled>();
  /** When `sendNow` emailed, over the last 24 hours. */
  private readonly sentNow: number[] = [];
  private readonly sending = new Set<Promise<void>>();

  constructor(
    private readonly recipients: string[],
    private readonly mailer: Mailer,
    private readonly log: Log,
    private readonly file: Log | null,
  ) {}

  /** Emails at once, unless 10 went in the last 24 hours: then it waits for a summary. */
  sendNow(subject: string, message: string): void {
    const now = Date.now();
    while (this.sentNow.length > 0 && this.sentNow[0]! <= now - DAY) this.sentNow.shift();
    if (this.sentNow.length >= SEND_NOW_PER_DAY) {
      this.throttle('send-now', `${subject}\n${message}`);
      return;
    }
    this.sentNow.push(now);
    this.note('send-now', `${subject}: ${message}`, 'emailed now');
    this.email(subject, message);
  }

  /**
   * Counts a message of `type` (a fixed name such as `poll:SPOT:429`: anything that changes belongs
   * in the message) and emails a summary at the end of each window that had any.
   */
  throttle(type: string, message: string): void {
    this.note(type, message, 'held for a summary');
    let state = this.types.get(type);
    if (!state) {
      state = { window: 0, since: Date.now(), count: 0, first: null };
      this.types.set(type, state);
      this.openWindow(type, state);
    }
    state.count++;
    state.first ??= message;
    clearTimeout(state.forgetTimer);
    state.forgetTimer = timer(FORGET_AFTER_MS, () => this.forget(type, state));
  }

  /** At shutdown: the summaries still due go out in one email, which gets 5 seconds at most. */
  async flush(): Promise<void> {
    const due = [...this.types].filter(([, state]) => state.count > 0);
    for (const state of this.types.values()) {
      clearTimeout(state.windowTimer);
      clearTimeout(state.forgetTimer);
    }
    this.types.clear();
    if (due.length > 0)
      this.email(
        `Shutting down: ${due.length} summaries`,
        due.map(([type, state]) => this.summary(type, state).text).join('\n\n----\n\n'),
      );

    let wait: NodeJS.Timeout | undefined;
    const late = await Promise.race([
      Promise.all(this.sending).then(() => false),
      new Promise<boolean>((resolve) => (wait = setTimeout(() => resolve(true), FLUSH_TIMEOUT_MS))),
    ]);
    clearTimeout(wait);
    if (late)
      this.log.warn({}, `Alert emails not sent after ${FLUSH_TIMEOUT_MS / 1000} s of shutdown`);
  }

  private note(type: string, message: string, what: string): void {
    const masked = message.replace(EMAIL, maskEmail);
    this.log.warn({ alert: type }, `Alert ${type}, ${what}: ${masked}`);
    this.file?.warn({}, `${type}, ${what}: ${masked}`);
  }

  private openWindow(type: string, state: Throttled): void {
    state.since = Date.now();
    const ms = WINDOWS_MS[Math.min(state.window, WINDOWS_MS.length - 1)]!;
    state.windowTimer = timer(ms, () => {
      this.sendSummary(type, state);
      state.window++;
      this.openWindow(type, state);
    });
  }

  /** 6 hours of quiet: what is left goes out now rather than at the end of a long window. */
  private forget(type: string, state: Throttled): void {
    clearTimeout(state.windowTimer);
    this.sendSummary(type, state);
    this.types.delete(type);
  }

  private sendSummary(type: string, state: Throttled): void {
    if (state.count === 0) return;
    const { subject, text } = this.summary(type, state);
    this.email(subject, text);
    state.count = 0;
    state.first = null;
  }

  private summary(type: string, state: Throttled) {
    const times = state.count === 1 ? 'once' : `${state.count} times`;
    const span = duration(Date.now() - state.since);
    return {
      subject: `${type}: ${times} in ${span}`,
      text: `${type}: ${times} in the last ${span}. The first:\n\n${state.first}`,
    };
  }

  /** In the background; a failure is a WARN in the log only, so it can never loop. */
  private email(subject: string, text: string): void {
    if (this.recipients.length === 0 || this.mailer.kind !== 'smtp') return;
    const run = this.mailer
      .send({
        to: this.recipients.join(', '),
        subject: `Flytrace: ${subject}`,
        text,
        html: `<pre>${escapeHtml(text)}</pre>`,
      })
      .then(() => this.file?.info({}, `Emailed: ${subject}`))
      .catch((err: unknown) =>
        this.log.warn({ err }, `Could not send the alert email "${subject}"`),
      )
      .finally(() => this.sending.delete(run));
    this.sending.add(run);
  }
}
