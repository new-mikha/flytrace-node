import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
// Node reads TZ for local time, so this moves the log times (and only them: pages print UTC explicitly).
if (config.LOG_TIMEZONE) process.env.TZ = config.LOG_TIMEZONE;
const app = await buildApp(config, createPool(config.DATABASE_URL));

const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
await app.listen({ port: config.PORT, host });
app.log.info(`Started: process id ${process.pid}, ${config.NODE_ENV}, time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
