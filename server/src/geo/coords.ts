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

// Latitudes and longitudes in the three formats of the legacy waypoints page (the owner picks one,
// `user_profiles.coord_format`): decimal degrees, degrees and minutes, degrees minutes and seconds.
// Shown as text, split into the fields of the edit forms, and read back from those fields. A
// coordinate is never split as text (the legacy edit form dropped the zero in "-26.06966" and
// broke the map): fractions are padded, minutes and seconds are carried over (59.9996' is 1° 00').
export type CoordFormat = 'Deg' | 'DegMin' | 'DegMinSec';
export type CoordKind = 'lat' | 'lon';

export const COORD_FORMATS: Record<CoordFormat, string> = {
  Deg: 'DD.DDDDDD°',
  DegMin: "DD°MM.MMM'",
  DegMinSec: 'DD°MM\'SS.S"',
};
export const isCoordFormat = (v: unknown): v is CoordFormat =>
  v === 'Deg' || v === 'DegMin' || v === 'DegMinSec';

const NBSP = ' ';
const LIMIT: Record<CoordKind, number> = { lat: 90, lon: 180 };
const LABEL: Record<CoordKind, string> = { lat: 'Latitude', lon: 'Longitude' };
const HEMISPHERES: Record<CoordKind, [string, string]> = { lat: ['S', 'N'], lon: ['W', 'E'] };

export const hemisphereOf = (value: number, kind: CoordKind): string =>
  HEMISPHERES[kind][value < 0 ? 0 : 1];

const two = (n: number) => String(n).padStart(2, '0');

/** Degrees, whole minutes and thousandths of a minute, rounded to the thousandth. */
function degMin(value: number) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let thousandths = Math.round((abs - deg) * 60 * 1000);
  if (thousandths >= 60000) {
    deg += 1;
    thousandths -= 60000;
  }
  return { deg, min: Math.floor(thousandths / 1000), fraction: thousandths % 1000 };
}

/** Degrees, whole minutes and tenths of a second, rounded to the tenth. */
function degMinSec(value: number) {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let tenths = Math.round((abs - deg) * 3600 * 10);
  if (tenths >= 36000) {
    deg += 1;
    tenths -= 36000;
  }
  const min = Math.floor(tenths / 600);
  const rest = tenths - min * 600;
  return { deg, min, sec: Math.floor(rest / 10), tenth: rest % 10 };
}

/** The coordinate for a table cell: "-27.15887", "S 27° 09.532'" or `S 27° 09' 31.9"`. */
export function formatCoord(value: number, kind: CoordKind, format: CoordFormat): string {
  const h = hemisphereOf(value, kind);
  if (format === 'DegMin') {
    const p = degMin(value);
    return `${h}${NBSP}${p.deg}°${NBSP}${two(p.min)}.${String(p.fraction).padStart(3, '0')}'`;
  }
  if (format === 'DegMinSec') {
    const p = degMinSec(value);
    return `${h}${NBSP}${p.deg}°${NBSP}${two(p.min)}'${NBSP}${two(p.sec)}.${p.tenth}"`;
  }
  return value.toFixed(5);
}

/**
 * The values of the edit fields. Names: Deg `lat` / `lon`; DegMin `latH` `latD` `latM`; DegMinSec
 * `latH` `latD` `latM` `latS` (and the same with `lon`). Decimal degrees keep every digit.
 */
export function coordFields(value: number, kind: CoordKind, format: CoordFormat) {
  if (format === 'Deg') return { [kind]: String(value) };
  const h = hemisphereOf(value, kind);
  if (format === 'DegMin') {
    const p = degMin(value);
    return {
      [`${kind}H`]: h,
      [`${kind}D`]: String(p.deg),
      [`${kind}M`]: `${two(p.min)}.${String(p.fraction).padStart(3, '0')}`,
    };
  }
  const p = degMinSec(value);
  return {
    [`${kind}H`]: h,
    [`${kind}D`]: String(p.deg),
    [`${kind}M`]: two(p.min),
    [`${kind}S`]: `${two(p.sec)}.${p.tenth}`,
  };
}

export type CoordResult = { value: number } | { error: string };

const NUMBER = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;
const num = (s: string) => Number(s.trim().replace(',', '.'));

/** The number in `raw`, or a message with `what` ("Latitude minutes") and the allowed range. */
function readNumber(raw: string | undefined, what: string, range: string, whole = false) {
  const s = (raw ?? '').trim();
  if (s === '') return { error: `${what} cannot be empty` };
  if (!NUMBER.test(s) || (whole && !/^\d+$/.test(s)))
    return { error: `${what} should be ${whole ? 'a whole number' : 'a number'} ${range}` };
  return { value: num(s) };
}

/** Reads one coordinate from the posted fields of `fields()` (see above). */
export function parseCoord(
  post: Record<string, string | undefined>,
  kind: CoordKind,
  format: CoordFormat,
): CoordResult {
  const label = LABEL[kind];
  const limit = LIMIT[kind];
  let value: number;
  if (format === 'Deg') {
    const d = readNumber(post[kind], label, `from -${limit} to ${limit}, like -27.15887`);
    if ('error' in d) return d;
    value = d.value;
  } else {
    const [neg, pos] = HEMISPHERES[kind];
    const h = (post[`${kind}H`] ?? '').trim().toUpperCase();
    if (h !== neg && h !== pos) return { error: `${label}: choose ${pos} or ${neg}` };
    const d = readNumber(post[`${kind}D`], `${label} degrees`, `from 0 to ${limit}`, true);
    if ('error' in d) return d;
    const m = readNumber(
      post[`${kind}M`],
      `${label} minutes`,
      format === 'DegMin' ? 'from 0 to 59.999' : 'from 0 to 59',
      format === 'DegMinSec',
    );
    if ('error' in m) return m;
    if (m.value >= 60) return { error: `${label} minutes should be less than 60` };
    value = d.value + m.value / 60;
    if (format === 'DegMinSec') {
      const s = readNumber(post[`${kind}S`], `${label} seconds`, 'from 0 to 59.9');
      if ('error' in s) return s;
      if (s.value >= 60) return { error: `${label} seconds should be less than 60` };
      value += s.value / 3600;
    }
    if (h === neg) value = -value;
  }
  if (!(Math.abs(value) <= limit))
    return { error: `${label} should be from -${limit} to ${limit} degrees` };
  return { value };
}
