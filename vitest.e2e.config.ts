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

import { defineConfig } from 'vitest/config';

// Browser tests (`npm run test:e2e`): a real server and a real Chrome. Kept apart from `npm test`,
// which needs no browser.
export default defineConfig({
  test: {
    include: ['server/e2e/**/*.e2e.ts'],
    env: { NODE_ENV: 'test' },
    fileParallelism: false, // tests share one dev database
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
