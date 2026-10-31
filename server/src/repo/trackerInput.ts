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

// What a person types into "SPOT or inReach page" and what is stored for it (rules of the legacy manageGroup page, docs/legacy-system.md §4.2).
// The legacy page also fetched the feed once to check it; that needs the tracker polling, which is not ported yet, so the id is only checked for shape.

export interface ParsedTracker {
  type: 'S' | 'G';
  /** SPOT: the shared page id (glId). inReach: `share.garmin.com/Feed/Share/<feed>#<imei>`, no scheme, always with the IMEI. */
  foreignId: string;
}

const SPOT =
  /^\s*?(?:(?:(?:http|https):\/\/)??share\.findmespot\.com\/shared\/faces\/viewspots\.jsp\?glId=)??([^\s\\/?=&#]{20,50})\s*?$/i;
const INREACH =
  /^\s*?(?:(?:[^\s#?&]+\.)?garmin\.com\/(?:[^\s#?&]+\/)*)??(?<id>[^\s#?&/]+)(?:\?[^#]*?)?\s*?(?:#\s*?(?<imei>\d*?))?\s*?$/i;

export const MAX_FOREIGN_ID = 445;

/**
 * `type` is what the person chose; without it the type is told from the text: a Garmin address or a `#` means inReach,
 * otherwise a 20 to 50 character id is SPOT.
 */
export function parseTrackerInput(
  input: string,
  type?: 'S' | 'G',
): ParsedTracker | { error: string } {
  const text = input.trim();
  if (text.length > MAX_FOREIGN_ID) return { error: 'That link is too long.' };
  const inReach = type ? type === 'G' : /garmin\.com|#/i.test(text);
  if (!inReach) {
    const spot = SPOT.exec(text);
    if (spot) return { type: 'S', foreignId: spot[1]! };
    if (type)
      return {
        error:
          'That does not look like a SPOT Shared Page link or ID (20 to 50 letters and digits).',
      };
  }
  const m = INREACH.exec(text);
  if (!m?.groups?.id)
    return {
      error:
        'We cannot recognize that as a SPOT Shared Page link or ID, or as an inReach feed link.',
    };

  if (!m.groups.imei)
    return {
      error: `An inReach feed needs the device's IMEI after a # sign, e.g. ${m.groups.id}#300434031769290.`,
    };

  return { type: 'G', foreignId: `share.garmin.com/Feed/Share/${m.groups.id}#${m.groups.imei}` };
}
