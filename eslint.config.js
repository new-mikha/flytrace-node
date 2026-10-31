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

// ESLint is used for one thing only: the brace rule for if / else / for / while, which Prettier
// does not enforce (it keeps braces as written). `npm run format` runs `eslint --fix` first, then
// Prettier (the layout of everything else; see .prettierrc.json).
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['**/node_modules/**', 'dist/**', '**/db/legacy/dump/**', 'public/vendor/**'] },
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      // One statement: no braces. If any block of an if / else if / else chain needs braces (more
      // than one statement), all of them get braces.
      curly: ['error', 'multi', 'consistent'],
    },
  },
];
