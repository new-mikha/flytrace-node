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

// What a person types into "SPOT or inReach page" and what is stored for it (rules of the legacy
// manageGroup page, docs/legacy-system.md §4.2). Each source knows its own ids; choosing between
// them is done here. The legacy page also fetched the feed once to check it; here the id is only
// checked for shape.
import { inReach } from '../tracking/sources/inreach.ts';
import { spot } from '../tracking/sources/spot.ts';

export interface ParsedTracker {
  type: 'S' | 'G';
  /**
   * SPOT: the shared page id (glId). inReach: `share.garmin.com/Feed/Share/<feed>#<imei>`, no
   * scheme, always with the IMEI.
   */
  foreignId: string;
}

export const MAX_FOREIGN_ID = 445;

/**
 * `type` is what the person chose; without it the type is told from the text: a Garmin address or a
 * `#` means inReach, otherwise a 20 to 50 character id is SPOT.
 */
export function parseTrackerInput(
  input: string,
  type?: 'S' | 'G',
): ParsedTracker | { error: string } {
  const text = input.trim();
  if (text.length > MAX_FOREIGN_ID) return { error: 'That link is too long.' };
  const isInReach = type ? type === 'G' : /garmin\.com|#/i.test(text);
  if (!isInReach) {
    const parsed = spot.parseFeedId(text);
    if ('feedId' in parsed) return { type: 'S', foreignId: parsed.feedId };
    if (type) return parsed;
  }
  const parsed = inReach.parseFeedId(text);
  return 'feedId' in parsed ? { type: 'G', foreignId: parsed.feedId } : parsed;
}
