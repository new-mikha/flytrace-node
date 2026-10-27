import { afterEach, describe, expect, it } from 'vitest';
import { formatAge, formatTimestamp } from '../src/views/format.ts';

const now = new Date('2026-03-05T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('formatTimestamp', () => {
  const savedZone = process.env.TZ;
  afterEach(() => { if (savedZone === undefined) delete process.env.TZ; else process.env.TZ = savedZone; });

  it('uses the "ddd d MMM H:mm zone" shape', () => {
    process.env.TZ = 'UTC';
    expect(formatTimestamp(new Date('2026-03-05T04:07:00Z'), now)).toBe('Thu 5 Mar 4:07 UTC');
    expect(formatTimestamp(new Date('2026-12-25T23:59:00Z'), now)).toBe('Fri 25 Dec 23:59 UTC');
    expect(formatTimestamp(new Date('2026-03-05T00:05:00Z'), now)).toBe('Thu 5 Mar 0:05 UTC');
  });

  it('shows the time in the configured zone, with its name', () => {
    process.env.TZ = 'Australia/Sydney'; // UTC+11 in March
    expect(formatTimestamp(new Date('2026-03-05T04:07:00Z'), now)).toBe('Thu 5 Mar 15:07 GMT+11');
    process.env.TZ = 'Europe/Berlin';
    expect(formatTimestamp(new Date('2026-03-05T04:07:00Z'), now)).toBe('Thu 5 Mar 5:07 GMT+1');
  });

  it('adds the year only when it is not the current year', () => {
    process.env.TZ = 'UTC';
    expect(formatTimestamp(new Date('2025-06-17T19:49:00Z'), now)).toBe('Tue 17 Jun 2025 19:49 UTC');
    expect(formatTimestamp(new Date('2027-01-02T10:00:00Z'), now)).toBe('Sat 2 Jan 2027 10:00 UTC');
  });

  it('decides the year in the configured zone', () => {
    // 20:00 UTC on New Year's Eve is already 2026 in Sydney, still 2025 in UTC.
    const d = new Date('2025-12-31T20:00:00Z');
    process.env.TZ = 'Australia/Sydney';
    expect(formatTimestamp(d, now)).toBe('Thu 1 Jan 7:00 GMT+11');
    process.env.TZ = 'UTC';
    expect(formatTimestamp(d, now)).toBe('Wed 31 Dec 2025 20:00 UTC');
  });
});

describe('formatAge', () => {
  it('shows minutes only for recent times', () => {
    expect(formatAge(minutesAgo(30), now)).toEqual({ text: '30 min ago', recent: true });
    expect(formatAge(minutesAgo(0), now)).toEqual({ text: '0 min ago', recent: true });
  });

  it('adds hours and days only when non-zero', () => {
    expect(formatAge(minutesAgo(90), now).text).toBe('1 hr 30 min ago');
    expect(formatAge(minutesAgo(60), now).text).toBe('1 hr 0 min ago');
    expect(formatAge(minutesAgo(26 * 60 + 5), now).text).toBe('1 d 2 hr 5 min ago');
    expect(formatAge(minutesAgo(24 * 60), now).text).toBe('1 d 0 hr 0 min ago');
  });

  it('is "recent" only within the last day', () => {
    expect(formatAge(minutesAgo(23 * 60 + 59), now).recent).toBe(true);
    expect(formatAge(minutesAgo(24 * 60), now).recent).toBe(false);
  });

  it('handles times in the future', () => {
    expect(formatAge(minutesAgo(-10), now)).toEqual({ text: '10 min ahead', recent: false });
  });
});
