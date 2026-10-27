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

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
// Node reads TZ for local time, so this moves the log times and the times shown on pages (`views/format.ts`).
if (config.LOG_TIMEZONE) process.env.TZ = config.LOG_TIMEZONE;
const app = await buildApp(config, createPool(config.DATABASE_URL));

const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
await app.listen({ port: config.PORT, host });
app.log.info(`Started: process id ${process.pid}, ${config.NODE_ENV}, time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
