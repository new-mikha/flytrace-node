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

// What the add and edit forms of the waypoints manager post, checked: the one place with the rules
// (the browser only checks that the fields are filled in and not too long).
import { type CoordFormat, parseCoord } from '../geo/coords.ts';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from './waypointFiles.ts';
import type { WaypointInput } from './waypoints.ts';

export const MAX_ALTITUDE = 100000;

/** A waypoint, or the messages by field (keys: name, description, lat, lon, alt): only the fields at fault. */
export type WaypointInputResult = { input: WaypointInput } | { errors: Record<string, string> };

const ALTITUDE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export function readWaypointInput(
  body: Record<string, string | undefined>,
  format: CoordFormat,
): WaypointInputResult {
  const errors: Record<string, string> = {};
  const name = (body.name ?? '').trim();
  const description = (body.description ?? '').trim() || null;
  if (name === '') errors.name = 'Enter a name for the waypoint.';
  else if (name.length > MAX_NAME_LENGTH)
    errors.name = `The name can have up to ${MAX_NAME_LENGTH} characters.`;
  if (description && description.length > MAX_DESCRIPTION_LENGTH)
    errors.description = `The description can have up to ${MAX_DESCRIPTION_LENGTH} characters.`;
  const lat = parseCoord(body, 'lat', format);
  if ('error' in lat) errors.lat = lat.error;
  const lon = parseCoord(body, 'lon', format);
  if ('error' in lon) errors.lon = lon.error;
  const altText = (body.alt ?? '').trim().replace(',', '.');
  const alt = Number(altText);
  if (!ALTITUDE.test(altText) || !Number.isFinite(alt))
    errors.alt = 'Altitude should be a number of meters, like 650';
  else if (Math.abs(alt) > MAX_ALTITUDE)
    errors.alt = `Altitude should be within ±${MAX_ALTITUDE} meters`;
  if (Object.keys(errors).length > 0 || !('value' in lat) || !('value' in lon)) return { errors };
  return { input: { name, description, lat: lat.value, lon: lon.value, alt } };
}
