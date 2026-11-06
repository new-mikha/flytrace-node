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

// What the tracking tests share: points, a log to look at, a fake `fetch` and feed documents.
import { readFileSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import { vi } from 'vitest';
import type { FeedPoint } from '../../src/tracking/sources/types.ts';

export const HOUR = 3600_000;

export const point = (
  id: string | undefined,
  time: string | number,
  more: Partial<FeedPoint> = {},
): FeedPoint => ({ id, lat: 1, lon: 2, ts: new Date(time), type: 'TRACK', ...more });

/** Samples from the legacy tests, slimmed and without names; positions and times are real. */
export const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/feeds/${name}`, import.meta.url), 'utf8');

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  details: unknown;
}

/** A logger that keeps its lines. Called as pino is: `(message)` or `(details, message)`. */
export function fakeLog() {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (first: unknown, second?: string): void => {
      if (second === undefined) lines.push({ level, message: String(first), details: undefined });
      else lines.push({ level, message: second, details: first });
    };
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  return { lines, log: log as unknown as FastifyBaseLogger };
}

/** Replaces `fetch`; `urls` are the addresses asked for, in order. */
export function stubFetch(answer: (url: string, call: number) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fetchStub = vi.fn((url: string) => {
    urls.push(url);
    return Promise.resolve(answer(url, urls.length - 1));
  });
  vi.stubGlobal('fetch', fetchStub);
  return { urls, fetchStub };
}

/** A promise settled from the outside: a request or a call that is still running. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A feed of inReach placemarks, in the order given (Garmin's: oldest first). */
export const inReachFeed = (points: { id?: string; time: string; imei?: string }[]) =>
  `<kml><Document><Folder>${points
    .map(
      ({ id, time, imei }) => `<Placemark><TimeStamp><when>${time}</when></TimeStamp>
      <ExtendedData>${id ? `<Data name="Id"><value>${id}</value></Data>` : ''}
      ${imei ? `<Data name="IMEI"><value>${imei}</value></Data>` : ''}</ExtendedData>
      <Point><coordinates>2,1,300</coordinates></Point></Placemark>`,
    )
    .join('')}</Folder></Document></kml>`;

/** A page of `count` SPOT messages, newest first, `stepMinutes` apart. */
export function spotPage(count: number, newest: string, stepMinutes: number): string {
  const start = new Date(newest).getTime();
  const messages = Array.from({ length: count }, (_, i) => {
    const time = new Date(start - i * stepMinutes * 60_000).toISOString().slice(0, 19);
    return `<message><id>${start - i}</id><latitude>1</latitude><longitude>2</longitude>
      <messageType>TRACK</messageType><dateTime>${time}+0000</dateTime></message>`;
  });
  return `<response><feedMessageResponse><messages>${messages.join('')}</messages></feedMessageResponse></response>`;
}

export const spotError = (text: string) =>
  `<response><errors><error><code>E-0</code><text>${text}</text></error></errors></response>`;
