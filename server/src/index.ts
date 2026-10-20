import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';

const config = loadConfig();
const app = await buildApp(config, createPool(config.DATABASE_URL));

const host = config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
await app.listen({ port: config.PORT, host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}
