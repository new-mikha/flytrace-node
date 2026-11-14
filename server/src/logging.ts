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

import { existsSync, renameSync } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pino, type DestinationStream, type Level, type Logger } from 'pino';
import { prettyFactory } from 'pino-pretty';

/**
 * Production log times: ISO 8601 in the process's time zone with its offset (pino's default is
 * epoch milliseconds).
 */
export function localIsoTime(): string {
  const d = new Date();
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
  return `,"time":"${date}T${time}${sign}${p(Math.floor(Math.abs(offset) / 60))}:${p(
    Math.abs(offset) % 60,
  )}"`;
}

/** pino-pretty's options for the readable lines of development. */
export const PRETTY_OPTIONS = {
  // SYS: = the process's time zone (LOG_TIMEZONE, else the host's), not UTC
  translateTime: 'SYS:HH:MM:ss',
  // messages are written to be read on their own; the fields stay in the JSON logs of production
  // and in the log files
  ignore: 'pid,hostname,reqId,event,user,userId,to,subject,action,ip',
  messageFormat: '{msg}{if user} [{user}]{end}',
};

/**
 * The readable lines of the log files: full date and time with the offset, the level, the message,
 * the other fields as JSON on the same line (an error's stack below it).
 */
const formatFileLine = prettyFactory({
  colorize: false,
  translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l o',
  ignore: 'pid,hostname,reqId,user',
  singleLine: true,
  messageFormat: '{msg}{if user} [{user}]{end}',
});

/** The log files and the lowest level each one takes. */
const FILES: Record<string, Level> = { info: 'info', warn: 'warn', error: 'error' };

/** Days of log files kept, today's included (owner's decision: the privacy policy promises it). */
export const KEEP_DAYS = 90;

/** `yyyy-MM-dd` of a time, in the log time zone, as in the file names. */
function dayOf(time: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${time.getFullYear()}-${p(time.getMonth() + 1)}-${p(time.getDate())}`;
}

/**
 * Deletes the log files of `dir` older than `KEEP_DAYS` days, today's included, going by the date
 * in their names; other files are left alone. Returns the names deleted.
 */
export async function pruneLogFiles(dir: string, now = new Date()): Promise<string[]> {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - (KEEP_DAYS - 1));
  const limit = dayOf(oldest);
  const names = (await readdir(dir)).filter((name) => {
    const day = /^(?:info|warn|error)\.(\d{4}-\d\d-\d\d)(?:\.\d+)?\.log$/.exec(name)?.[1];
    return day !== undefined && day < limit;
  });
  await Promise.all(names.map((name) => unlink(join(dir, name))));
  return names;
}

type FileStream = ReturnType<typeof pino.destination>;

/**
 * Moves an existing `<path>.log` to the next free `<path>.<n>.log` (`.1` the oldest), so that each
 * run of the app gets a file of its own. A failure only means appending to the old file.
 */
function moveAside(path: string, name: string): void {
  if (!existsSync(`${path}.log`)) return;
  let n = 1;
  while (existsSync(`${path}.${n}.log`)) n++;
  try {
    renameSync(`${path}.log`, `${path}.${n}.log`);
  } catch (err) {
    process.stderr.write(`Log file ${name}: ${(err as Error).message}\n`);
  }
}

/**
 * A stream writing to `<dir>/<name>.<date>.log`, the date being that of the line in the log time
 * zone. A file is opened when its first line comes, so a quiet day (most days of `error`) leaves
 * none, and the file of the day before is closed then. A file of the same day left by an earlier
 * run is renamed first (`moveAside`).
 */
function dailyFile(dir: string, name: string) {
  let file: FileStream | null = null;
  let until = 0; // the next midnight
  const closing: Promise<void>[] = [];
  const end = (stream: FileStream) =>
    new Promise<void>((resolve) => {
      stream.once('close', () => resolve());
      stream.end();
    });

  return {
    write(line: string) {
      const now = new Date();
      if (!file || now.getTime() >= until) {
        if (file) closing.push(end(file));
        const next = new Date(now);
        next.setHours(24, 0, 0, 0);
        until = next.getTime();
        const path = join(dir, `${name}.${dayOf(now)}`);
        moveAside(path, name);
        file = pino.destination({
          dest: `${path}.log`,
          mkdir: true,
          append: true,
          sync: false,
        });
        // A full disk must not crash the app (an 'error' event with no listener would): stdout
        // still has every line.
        file.on('error', (err: Error) =>
          process.stderr.write(`Log file ${name}: ${err.message}\n`),
        );
      }
      file.write(formatFileLine(line));
    },
    /** Writes out what is still buffered. */
    close: () => Promise.all([...closing, ...(file ? [end(file)] : [])]).then(() => undefined),
  };
}

/**
 * A logger writing to `stdout` and to the files in `dir`, one readable line each
 * (`formatFileLine`):
 * `info.<date>.log` gets every line, `warn.<date>.log` WARN and up, `error.<date>.log` ERROR and
 * up (`dailyFile`). The files older than `KEEP_DAYS` days are deleted at startup and a minute
 * after each midnight. `close` writes out what is still buffered.
 */
export async function fileLogger(
  dir: string,
  stdout: DestinationStream,
): Promise<{ logger: Logger; close: () => Promise<void> }> {
  await mkdir(dir, { recursive: true });
  const files = Object.entries(FILES).map(([name, level]) => ({
    level,
    stream: dailyFile(dir, name),
  }));

  const logger = pino(
    { level: 'info', timestamp: localIsoTime },
    pino.multistream([{ level: 'info', stream: stdout }, ...files]),
  );

  const prune = () =>
    pruneLogFiles(dir).catch((err: Error) =>
      logger.warn(`Could not delete old log files: ${err.message}`),
    );
  let pruneTimer: NodeJS.Timeout | undefined;
  const pruneAfterMidnight = () => {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(0, 1, 0, 0);
    pruneTimer = setTimeout(() => {
      void prune();
      pruneAfterMidnight();
    }, next.getTime() - Date.now()).unref();
  };
  await prune();
  pruneAfterMidnight();

  const close = async () => {
    clearTimeout(pruneTimer);
    await Promise.all(files.map(({ stream }) => stream.close()));
  };

  return { logger, close };
}
