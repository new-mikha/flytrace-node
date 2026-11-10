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

// The log files of LOG_DIR: which lines go where, a new file each day, 90 days kept.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileLogger, KEEP_DAYS, pruneLogFiles } from '../src/logging.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flytrace-logs-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

/** A stand-in for stdout, keeping the lines written to it. */
function stdout() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString().trim().split('\n'));
      done();
    },
  });
  return { lines, stream };
}

const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function messages(file: string): Promise<string[]> {
  const text = await readFile(join(dir, file), 'utf8');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { msg: string }).msg);
}

describe('the log files', () => {
  it('gives each file the lines of its level and up, and stdout every line', async () => {
    const out = stdout();
    const { logger, close } = await fileLogger(dir, out.stream);
    logger.info('an info line');
    logger.warn('a warning');
    logger.error('an error');
    logger.fatal('a crash');
    await close();

    const today = day(new Date());
    expect((await readdir(dir)).sort()).toEqual([
      `error.${today}.log`,
      `info.${today}.log`,
      `warn.${today}.log`,
    ]);
    expect(await messages(`info.${today}.log`)).toEqual([
      'an info line',
      'a warning',
      'an error',
      'a crash',
    ]);
    expect(await messages(`warn.${today}.log`)).toEqual(['a warning', 'an error', 'a crash']);
    expect(await messages(`error.${today}.log`)).toEqual(['an error', 'a crash']);
    expect(out.lines).toHaveLength(4);
  });

  it('writes local ISO times with the offset', async () => {
    const { logger, close } = await fileLogger(dir, stdout().stream);
    logger.info('timed');
    await close();

    const [line] = (await readFile(join(dir, `info.${day(new Date())}.log`), 'utf8')).split('\n');
    expect(JSON.parse(line!).time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  });

  it('numbers the files of earlier runs of the day, the oldest .1', async () => {
    for (const text of ['first', 'second', 'third']) {
      const { logger, close } = await fileLogger(dir, stdout().stream);
      logger.info(text);
      await close();
    }
    const today = day(new Date());
    expect(await messages(`info.${today}.1.log`)).toEqual(['first']);
    expect(await messages(`info.${today}.2.log`)).toEqual(['second']);
    expect(await messages(`info.${today}.log`)).toEqual(['third']);
  });

  it('renames only the files a run writes to', async () => {
    const first = await fileLogger(dir, stdout().stream);
    first.logger.warn('a warning');
    await first.close();
    const second = await fileLogger(dir, stdout().stream);
    second.logger.info('fine');
    await second.close();

    const today = day(new Date());
    expect((await readdir(dir)).sort()).toEqual([
      `info.${today}.1.log`,
      `info.${today}.log`,
      `warn.${today}.log`,
    ]);
  });

  it('makes a file only when a line comes for it', async () => {
    const { logger, close } = await fileLogger(dir, stdout().stream);
    logger.info('nothing wrong');
    await close();
    expect(await readdir(dir)).toEqual([`info.${day(new Date())}.log`]);
  });

  it('goes on in a new file after midnight', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 10, 23, 59), toFake: ['Date'] });
    const { logger, close } = await fileLogger(dir, stdout().stream);
    logger.info('late');
    logger.warn('late warning');
    vi.setSystemTime(new Date(2026, 10, 11, 0, 1));
    logger.info('early');
    await close();

    expect((await readdir(dir)).sort()).toEqual([
      'info.2026-11-10.log',
      'info.2026-11-11.log',
      'warn.2026-11-10.log',
    ]);
    expect(await messages('info.2026-11-10.log')).toEqual(['late', 'late warning']);
    expect(await messages('info.2026-11-11.log')).toEqual(['early']);
  });
});

describe('the files kept', () => {
  /** Makes the files of 101 days before `now`, and a file that is not a log. */
  async function oldFiles(now: Date) {
    for (let i = 1; i <= 101; i++) {
      const old = new Date(now);
      old.setDate(now.getDate() - i);
      for (const name of ['info', 'warn', 'error'])
        await writeFile(join(dir, `${name}.${day(old)}.log`), '');
    }
    await writeFile(join(dir, 'notes.txt'), '');
    // a file of an earlier run of an old day:
    await writeFile(join(dir, 'info.2026-01-01.1.log'), '');
  }

  const days = async (name: string) =>
    (await readdir(dir))
      .filter((f) => f.startsWith(`${name}.`))
      .map((f) => f.split('.')[1])
      .sort();

  it('are those of the last 90 days, today included, going by the names', async () => {
    const now = new Date(2026, 10, 10, 0, 1);
    await oldFiles(now);
    await writeFile(join(dir, `info.${day(now)}.log`), '');
    // an earlier run of the oldest day kept:
    await writeFile(join(dir, 'info.2026-08-13.1.log'), '');

    await pruneLogFiles(dir, now);

    const info = await days('info');
    expect(info).toHaveLength(KEEP_DAYS + 1);
    expect(info.slice(0, 2)).toEqual(['2026-08-13', '2026-08-13']);
    expect(info.at(-1)).toBe('2026-11-10');
    expect(await days('error')).toEqual(info.slice(1, -1));
    expect(await readdir(dir)).toContain('notes.txt');
  });

  it('are pruned when the logger starts, and a minute after midnight', async () => {
    const now = new Date(2026, 10, 10, 23, 59);
    vi.useFakeTimers({ now, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await oldFiles(now);

    const { close } = await fileLogger(dir, stdout().stream);
    expect((await days('warn'))[0]).toBe('2026-08-13');

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await days('warn'))[0]).toBe('2026-08-14'));
    await close();
  });
});
