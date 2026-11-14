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

// The alerts to the owners: sent at once, or counted into summaries; on a fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailLogger } from '../src/alerts/emailLogger.ts';
import type { MailMessage, Mailer } from '../src/mail/mailer.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const OWNERS = ['one@example.test', 'two@example.test'];

interface Line {
  level: 'info' | 'warn';
  fields: object;
  message: string;
}

function setUp({ recipients = OWNERS, kind = 'smtp' as Mailer['kind'], fail = false } = {}) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    kind,
    send: vi.fn(async (message: MailMessage) => {
      if (fail) throw new Error('SMTP down');
      sent.push(message);
    }),
  };
  const lines: Line[] = [];
  const fileLines: Line[] = [];
  const logTo = (into: Line[]) => ({
    info: (fields: object, message: string) => into.push({ level: 'info', fields, message }),
    warn: (fields: object, message: string) => into.push({ level: 'warn', fields, message }),
  });
  const alerts = new EmailLogger(recipients, mailer, logTo(lines), logTo(fileLines));
  return { alerts, sent, mailer, lines, fileLines };
}

const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const subjects = (sent: MailMessage[]) => sent.map((m) => m.subject);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 14, 12, 0) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendNow', () => {
  it('emails every owner at once', async () => {
    const { alerts, sent } = setUp();
    alerts.sendNow('New account: pilot', 'pilot, pilot@example.test: "Confirm" sent.');
    await pass(0);

    expect(sent).toEqual([
      expect.objectContaining({
        to: 'one@example.test, two@example.test',
        subject: 'Flytrace: New account: pilot',
        text: 'pilot, pilot@example.test: "Confirm" sent.',
      }),
    ]);
  });

  it('emails 10 in 24 hours, and holds the rest for a summary under "send-now"', async () => {
    const { alerts, sent } = setUp();
    for (let i = 1; i <= 12; i++) alerts.sendNow(`Email ${i}`, `message ${i}`);
    await pass(0);
    expect(sent).toHaveLength(10);

    await pass(MINUTE);
    expect(sent).toHaveLength(11);
    expect(sent[10]!.subject).toBe('Flytrace: send-now: 2 times in 60 seconds');
    expect(sent[10]!.text).toContain('Email 11\nmessage 11');

    await pass(24 * HOUR - MINUTE);
    alerts.sendNow('Email 13', 'a day later');
    await pass(0);
    expect(sent.at(-1)!.subject).toBe('Flytrace: Email 13');
  });
});

describe('throttle', () => {
  it('sends a summary a minute after the first message, quoting it', async () => {
    const { alerts, sent } = setUp();
    alerts.throttle('poll:SPOT:429', 'S:abc failed: 429');
    await pass(30 * SECOND);
    alerts.throttle('poll:SPOT:429', 'S:def failed: 429');
    expect(sent).toEqual([]);

    await pass(30 * SECOND);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Flytrace: poll:SPOT:429: 2 times in 60 seconds');
    expect(sent[0]!.text).toBe(
      'poll:SPOT:429: 2 times in the last 60 seconds. The first:\n\nS:abc failed: 429',
    );
  });

  it('then waits 10 minutes, an hour, and a day each time after', async () => {
    const { alerts, sent } = setUp();
    // a message every 70 seconds, for 50 hours:
    const start = Date.now();
    const at: number[] = [];
    while (Date.now() - start < 50 * HOUR) {
      alerts.throttle('server-error', 'GET / 500');
      const before = sent.length;
      await pass(70 * SECOND);
      if (sent.length > before) at.push(Math.round((Date.now() - start) / MINUTE));
    }
    // due at 1, 11, 71, 1511 and 2951 minutes, seen at the end of the 70-second step they fall in:
    expect(at).toEqual([1, 12, 71, 1512, 2952]);
  });

  it('keeps the types apart', async () => {
    const { alerts, sent } = setUp();
    alerts.throttle('poll:SPOT:429', 'a');
    alerts.throttle('poll:Garmin inReach:503', 'b');
    await pass(MINUTE);
    expect(subjects(sent).sort()).toEqual([
      'Flytrace: poll:Garmin inReach:503: once in 60 seconds',
      'Flytrace: poll:SPOT:429: once in 60 seconds',
    ]);
  });

  it('moves on after an empty window: a message 3 hours later waits for the quiet to end', async () => {
    const { alerts, sent } = setUp();
    alerts.throttle('smtp-failed', 'first');
    await pass(3 * HOUR);
    expect(sent).toHaveLength(1);

    alerts.throttle('smtp-failed', 'second');
    await pass(6 * HOUR - SECOND);
    expect(sent).toHaveLength(1);
    await pass(SECOND);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('The first:\n\nsecond');
  });

  it('forgets a type after 6 quiet hours: the next message is sent after a minute again', async () => {
    const { alerts, sent } = setUp();
    alerts.throttle('server-error', 'first');
    await pass(6 * HOUR);
    expect(sent).toHaveLength(1);

    alerts.throttle('server-error', 'again');
    await pass(MINUTE);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('Flytrace: server-error: once in 60 seconds');
  });
});

describe('the log lines', () => {
  it('are a WARN with the type, and a line in the email-logger file, addresses in full', () => {
    const { alerts, lines, fileLines } = setUp();
    alerts.sendNow('New account: pilot', 'pilot, pilot@example.test');
    alerts.throttle('smtp-failed', 'to pilot@example.test: refused');

    expect(lines).toEqual([
      {
        level: 'warn',
        fields: { alert: 'send-now' },
        message: 'Alert send-now, emailed now: New account: pilot: pilot, pilot@example.test',
      },
      {
        level: 'warn',
        fields: { alert: 'smtp-failed' },
        message: 'Alert smtp-failed, held for a summary: to pilot@example.test: refused',
      },
    ]);
    expect(fileLines.map((l) => l.message)).toEqual([
      'send-now, emailed now: New account: pilot: pilot, pilot@example.test',
      'smtp-failed, held for a summary: to pilot@example.test: refused',
    ]);
  });

  it('note each email sent in the file', async () => {
    const { alerts, fileLines } = setUp();
    alerts.sendNow('New account: pilot', 'details');
    await pass(0);
    expect(fileLines.at(-1)).toEqual({
      level: 'info',
      fields: {},
      message: 'Emailed: New account: pilot',
    });
  });
});

describe('sending', () => {
  it('emails nobody without recipients or without SMTP, but still logs', async () => {
    for (const options of [{ recipients: [] }, { kind: 'log' as const }]) {
      const { alerts, mailer, lines } = setUp(options);
      alerts.sendNow('New account: pilot', 'details');
      alerts.throttle('server-error', 'GET / 500');
      await pass(MINUTE);
      expect(mailer.send).not.toHaveBeenCalled();
      expect(lines).toHaveLength(2);
    }
  });

  it('logs a failure as a WARN only, never as another alert', async () => {
    const { alerts, mailer, lines } = setUp({ fail: true });
    alerts.sendNow('New account: pilot', 'details');
    await pass(HOUR);

    expect(mailer.send).toHaveBeenCalledOnce();
    expect(lines.at(-1)).toEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Could not send the alert email "New account: pilot"',
      }),
    );
  });
});

describe('flush', () => {
  it('sends the summaries still due in one email, and then nothing more', async () => {
    const { alerts, sent } = setUp();
    alerts.throttle('server-error', 'GET / 500');
    alerts.throttle('poll:SPOT:timeout', 'S:abc timed out');
    await alerts.flush();

    expect(subjects(sent)).toEqual(['Flytrace: Shutting down: 2 summaries']);
    expect(sent[0]!.text).toContain('server-error: once');
    expect(sent[0]!.text).toContain('S:abc timed out');

    await pass(7 * HOUR);
    expect(sent).toHaveLength(1);
  });

  it('gives up after 5 seconds and says so', async () => {
    const { alerts, mailer, lines } = setUp();
    vi.mocked(mailer.send).mockReturnValue(new Promise(() => {}));
    alerts.throttle('server-error', 'GET / 500');

    const flushed = alerts.flush();
    await pass(5 * SECOND);
    await flushed;
    expect(lines.at(-1)!.message).toBe('Alert emails not sent after 5 s of shutdown');
  });
});
