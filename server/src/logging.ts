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

import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pino, type DestinationStream, type Level, type Logger } from 'pino';
import pinoRoll from 'pino-roll';

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
    const day = /^(?:info|warn|error)\.(\d{4}-\d\d-\d\d)\.\d+\.log$/.exec(name)?.[1];
    return day !== undefined && day < limit;
  });
  await Promise.all(names.map((name) => unlink(join(dir, name))));
  return names;
}

/**
 * A logger writing to `stdout` and to the files in `dir`, one JSON line each:
 * `info.<date>.1.log` gets every line, `warn.<date>.1.log` WARN and up, `error.<date>.1.log` ERROR
 * and up. A new file each day at midnight in the log time zone (pino-roll); the files older than
 * `KEEP_DAYS` days are deleted at startup and a minute after each midnight (pino-roll's own limit
 * goes by a count of files, which came out a day or two over). `close` writes out what is still
 * buffered.
 */
export async function fileLogger(
  dir: string,
  stdout: DestinationStream,
): Promise<{ logger: Logger; close: () => Promise<void> }> {
  const files = await Promise.all(
    Object.entries(FILES).map(async ([name, level]) => {
      const stream = await pinoRoll({
        file: `${dir}/${name}`,
        extension: '.log',
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        mkdir: true,
      });
      // A full disk must not crash the app (an 'error' event with no listener would): stdout
      // still has every line.
      stream.on('error', (err: Error) =>
        process.stderr.write(`Log file ${name}: ${err.message}\n`),
      );
      return { level, stream };
    }),
  );

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

  const close = () => {
    clearTimeout(pruneTimer);
    return Promise.all(
      files.map(
        ({ stream }) =>
          new Promise<void>((resolve) => {
            stream.once('close', () => resolve());
            stream.end();
          }),
      ),
    ).then(() => undefined);
  };

  return { logger, close };
}
