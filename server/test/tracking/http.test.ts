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

// The one request of every source, and what its failures mean.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeed, findAll } from '../../src/tracking/sources/http.ts';
import { stubFetch } from './helpers.ts';

const URL_ = 'https://feeds.example/x';
const open = () => new AbortController().signal;
const get = (signal = open()) => fetchFeed(URL_, signal, 'SPOT');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A `fetch` that hangs until its signal fires, as a real one would. */
function hangingFetch() {
  vi.stubGlobal(
    'fetch',
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(init.signal.reason as Error);
        });
      }),
  );
}

describe('fetchFeed', () => {
  it('gives the text of a good answer, asking for XML', async () => {
    const { fetchStub } = stubFetch(() => new Response('<a/>'));
    expect(await get()).toEqual({ text: '<a/>' });

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_);
    expect((init.headers as Record<string, string>).accept).toContain('application/xml');
  });

  it('takes a 404 for a feed that does not exist', async () => {
    stubFetch(() => new Response('', { status: 404, headers: { 'x-a': 'b' } }));
    expect(await get()).toMatchObject({
      error: {
        kind: 'bad-feed-id',
        userMessage: 'The tracker ID is not recognized by the SPOT server.',
        status: 404,
        headers: { 'x-a': 'b' },
      },
    });
  });

  it.each([
    [429, 'throttled'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, 'source-error'],
    [503, 'source-error'],
  ])('reports a %i as %s, with the status in the words', async (status, kind) => {
    stubFetch(() => new Response('', { status }));
    const answer = await get();
    expect(answer).toMatchObject({ error: { kind, status } });
    expect('error' in answer && answer.error.userMessage).toContain(String(status));
  });

  it('keeps all the headers of a refusal', async () => {
    const headers = { 'x-rate-limit': '10', server: 'nginx', 'retry-after': '120' };
    stubFetch(() => new Response('', { status: 429, headers }));
    expect(await get()).toMatchObject({ error: { headers, retryAfterMs: 120_000 } });
  });

  it('reads a Retry-After that is a date', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-10T12:00:00Z') });
    const headers = { 'retry-after': 'Sat, 10 Jan 2026 12:01:00 GMT' };
    stubFetch(() => new Response('', { status: 503, headers }));
    expect(await get()).toMatchObject({ error: { retryAfterMs: 60_000 } });
  });

  it('never gives a negative wait for a date in the past', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-01-10T12:00:00Z') });
    const headers = { 'retry-after': 'Sat, 10 Jan 2026 11:00:00 GMT' };
    stubFetch(() => new Response('', { status: 503, headers }));
    expect(await get()).toMatchObject({ error: { retryAfterMs: 0 } });
  });

  it('ignores a Retry-After it cannot read, and a missing one', async () => {
    const headers = { 'retry-after': 'soon' };
    stubFetch(() => new Response('', { status: 503, headers }));
    const answer = await get();
    expect('error' in answer && answer.error.retryAfterMs).toBeUndefined();
  });

  it('drops the body of a refusal, which would hold the connection', async () => {
    const response = new Response('some text', { status: 500 });
    stubFetch(() => response);
    await get();
    expect(response.bodyUsed).toBe(true);
  });

  it('reports the code of a network failure, not "fetch failed"', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    });
    vi.stubGlobal('fetch', () => Promise.reject(failure));
    expect(await get()).toMatchObject({ error: { kind: 'network', detail: 'ECONNRESET' } });
  });

  it('copes with a network failure that has no code', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    expect(await get()).toMatchObject({ error: { kind: 'network', detail: 'TypeError' } });
  });

  it('gives up on one request after 10 seconds', async () => {
    const limit = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(limit.signal);
    hangingFetch();

    const answer = get();
    expect(timeout).toHaveBeenCalledWith(10_000);

    limit.abort(new DOMException('late', 'TimeoutError'));
    expect(await answer).toMatchObject({ error: { kind: 'timeout' } });
  });

  it('counts the whole call running out as a timeout too', async () => {
    const call = new AbortController();
    hangingFetch();

    const answer = get(call.signal);
    call.abort(new DOMException('late', 'TimeoutError'));
    expect(await answer).toMatchObject({ error: { kind: 'timeout' } });
  });

  it('rejects on a shutdown, which is no failure of the feed', async () => {
    const shutdown = new AbortController();
    hangingFetch();

    const answer = get(shutdown.signal);
    shutdown.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('never puts the address in what the map shows', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    const answer = await get();
    expect(JSON.stringify(answer)).not.toContain('feeds.example');
  });
});

describe('findAll', () => {
  it('finds a key at any depth, in lists too', () => {
    const tree = { a: { b: [{ key: 1 }, { c: { key: 2 } }] }, key: 3 };
    expect(findAll(tree, 'key').sort()).toEqual([1, 2, 3]);
  });

  it('spreads a list found under the key', () => {
    expect(findAll({ key: [1, 2] }, 'key')).toEqual([1, 2]);
  });

  it('finds nothing in things that hold nothing', () => {
    expect(findAll(null, 'key')).toEqual([]);
    expect(findAll('text', 'key')).toEqual([]);
  });
});
