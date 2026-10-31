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

// Every source file carries the license header (see AGENTS.md).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from '../src/paths.ts';

const ROOT = projectRoot();
const EXTENSIONS = /\.(ts|tsx|js|css|sql|sh)$/;
// Folders that are not ours: dependencies, build output, the production dump (never read), and the
// copy of the old MSSQL script.
const SKIP = new Set(['node_modules', 'dist', '.git', 'dump', 'orig-mssql-db-script.sql']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : EXTENSIONS.test(entry.name) ? [path] : [];
  });
}

describe('license headers', () => {
  it('are on every source file', () => {
    const files = ['server', 'public', 'scripts', 'db']
      .flatMap((d) => sourceFiles(join(ROOT, d)))
      .concat(join(ROOT, 'vitest.config.ts'));
    expect(files.length).toBeGreaterThan(50);
    const missing = files.filter(
      (f) =>
        !readFileSync(f, 'utf8').slice(0, 1200).includes('GNU Affero General Public License as'),
    );
    expect(missing.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
