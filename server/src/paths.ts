import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Directory of an installed npm package: walks up from its entry file to the package.json with that name. */
export function packageDir(name: string): string {
  let dir = dirname(require.resolve(name));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`Package ${name} not found`);
    dir = up;
  }
}

/** The folder holding the project's package.json (works from `server/src` and from `dist/server/src`). */
export function projectRoot(): string {
  let dir = import.meta.dirname;
  while (!existsSync(join(dir, 'package.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('Project root not found');
    dir = up;
  }
  return dir;
}
