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

// The one HTTP request all sources make, and what its failures mean.
import type { FeedError } from './types.ts';

/** One request. A call of several requests has its own limit too, `callTimeoutMs` of the source. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Without this the undocumented SPOT address answers in JSON (a note from the legacy code). */
const ACCEPT = 'text/html,application/xhtml+xml,application/xml';

const cannotRetrieve = (why: string) => `Cannot retrieve location data for the tracker: ${why}`;

export const badFeedId = (sourceName: string): FeedError => ({
  kind: 'bad-feed-id',
  userMessage: `The tracker ID is not recognized by the ${sourceName} server.`,
});

export const noData = (): FeedError => ({
  kind: 'no-data',
  userMessage: 'No coordinates found for the tracker.',
});

export const sourceError = (why: string): FeedError => ({
  kind: 'source-error',
  userMessage: cannotRetrieve(why),
  detail: why,
});

/** `Retry-After` in milliseconds: the header holds either seconds or a date. Only logged so far. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function httpError(response: Response, sourceName: string): FeedError {
  const { status } = response;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const facts = {
    status,
    headers,
    retryAfterMs: retryAfter(response.headers.get('retry-after')),
  };
  // The one status legacy told apart: a feed that does not exist.
  if (status === 404) return { ...badFeedId(sourceName), ...facts };
  const userMessage = cannotRetrieve(`the server answered ${status}.`);
  if (status === 429) return { kind: 'throttled', userMessage, ...facts };
  if (status === 401 || status === 403) return { kind: 'unauthorized', userMessage, ...facts };
  return { kind: 'source-error', userMessage, ...facts };
}

/** The text of `url`, or what went wrong. Rejects only for a shutdown (an `AbortError`). */
export async function fetchFeed(
  url: string,
  signal: AbortSignal,
  sourceName: string,
): Promise<{ text: string } | { error: FeedError }> {
  try {
    const response = await fetch(url, {
      headers: { accept: ACCEPT },
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      // We will not read it, and until it is dropped it holds the connection:
      await response.body?.cancel();
      return { error: httpError(response, sourceName) };
    }
    return { text: await response.text() };
  } catch (err) {
    // The name tells which signal fired: a timeout gives TimeoutError, the shutdown AbortError.
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'AbortError') throw err;
    if (e.name === 'TimeoutError')
      return { error: { kind: 'timeout', userMessage: cannotRetrieve('no answer in time.') } };
    // `fetch` says only "fetch failed"; the real reason (ECONNRESET, ENOTFOUND...) is in the cause:
    const why = e.cause?.code ?? e.name;
    return { error: { kind: 'network', userMessage: cannotRetrieve(why), detail: why } };
  }
}

/** All the values under `key`, however deep: the feeds' wrappers have changed over the years. */
export function findAll(node: unknown, key: string, found: unknown[] = []): unknown[] {
  // A list too: its entries are its items, under names like '0' that are never the key.
  if (node && typeof node === 'object')
    for (const [name, value] of Object.entries(node))
      if (name === key) found.push(...(Array.isArray(value) ? value : [value]));
      else findAll(value, key, found);

  return found;
}
