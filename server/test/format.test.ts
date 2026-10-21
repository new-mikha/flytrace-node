import { describe, expect, it } from 'vitest';
import { formatAge, formatTimestamp } from '../src/views/format.ts';

const now = new Date('2026-03-05T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('formatTimestamp', () => {
  it('uses the legacy "ddd d MMM H:mm UTC" shape', () => {
    expect(formatTimestamp(new Date('2026-03-05T04:07:00Z'))).toBe('Thu 5 Mar 4:07 UTC');
    expect(formatTimestamp(new Date('2026-12-25T23:59:00Z'))).toBe('Fri 25 Dec 23:59 UTC');
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
