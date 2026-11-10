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

// pino-roll ships no types: the part of its options used here (`logging.ts`).
declare module 'pino-roll' {
  import type SonicBoom from 'sonic-boom';

  interface Options {
    file: string;
    frequency?: 'daily' | 'hourly' | number;
    extension?: string;
    dateFormat?: string;
    mkdir?: boolean;
    limit?: { count: number; removeOtherLogFiles?: boolean };
  }

  export default function pinoRoll(options: Options): Promise<SonicBoom>;
}
