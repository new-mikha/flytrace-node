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

// The server's checks of the add and edit forms of the waypoints manager: what is accepted, what
// the figure comes out as, and that only the fields that are really wrong get a message.
import { describe, expect, it } from 'vitest';
import type { CoordFormat } from '../src/geo/coords.ts';
import { readWaypointInput } from '../src/repo/waypointInput.ts';

const GOOD: Record<CoordFormat, Record<string, string>> = {
  Deg: { name: 'MT DARE', lat: '-26.06966', lon: '135.5', alt: '650', description: 'the hill' },
  DegMin: {
    name: 'MT DARE',
    latH: 'S',
    latD: '26',
    latM: '04.180',
    lonH: 'E',
    lonD: '135',
    lonM: '30',
    alt: '650',
    description: 'the hill',
  },
  DegMinSec: {
    name: 'MT DARE',
    latH: 'S',
    latD: '26',
    latM: '04',
    latS: '10.8',
    lonH: 'E',
    lonD: '135',
    lonM: '30',
    lonS: '00.0',
    alt: '650',
    description: 'the hill',
  },
};
const FORMATS = Object.keys(GOOD) as CoordFormat[];

/** The messages' keys, sorted, or [] for an accepted form. */
function bad(format: CoordFormat, change: Record<string, string>): string[] {
  const r = readWaypointInput({ ...GOOD[format], ...change }, format);
  return 'errors' in r ? Object.keys(r.errors).sort() : [];
}

describe.each(FORMATS)('a valid form in %s', (format) => {
  it('is accepted, with the same point whatever the format', () => {
    const r = readWaypointInput(GOOD[format], format);
    if (!('input' in r)) throw new Error(JSON.stringify(r));
    expect(r.input.name).toBe('MT DARE');
    expect(r.input.description).toBe('the hill');
    expect(r.input.alt).toBe(650);
    expect(r.input.lat).toBeCloseTo(-26.06966, 4); // minutes are typed to 0.001'
    expect(r.input.lon).toBeCloseTo(135.5, 9);
  });

  it('trims the name and the description, and an empty description is none', () => {
    const r = readWaypointInput({ ...GOOD[format], name: '  A  ', description: '   ' }, format);
    expect(r).toMatchObject({ input: { name: 'A', description: null } });
  });

  it('takes a comma as the decimal point and a negative or zero altitude', () => {
    expect(readWaypointInput({ ...GOOD[format], alt: '-12,5' }, format)).toMatchObject({
      input: { alt: -12.5 },
    });
    expect(readWaypointInput({ ...GOOD[format], alt: '0' }, format)).toMatchObject({
      input: { alt: 0 },
    });
  });

  it('accepts the limits: name 50, description 500, altitude ±100000', () => {
    expect(bad(format, { name: 'N'.repeat(50) })).toEqual([]);
    expect(bad(format, { description: 'D'.repeat(500) })).toEqual([]);
    expect(bad(format, { alt: '100000' })).toEqual([]);
    expect(bad(format, { alt: '-100000' })).toEqual([]);
  });
});

describe.each(FORMATS)('mistakes in %s: only the fields at fault are flagged', (format) => {
  it('the name', () => {
    expect(bad(format, { name: '' })).toEqual(['name']);
    expect(bad(format, { name: '   ' })).toEqual(['name']);
    expect(bad(format, { name: 'N'.repeat(51) })).toEqual(['name']);
  });

  it('the description', () => {
    expect(bad(format, { description: 'D'.repeat(501) })).toEqual(['description']);
  });

  it('the altitude', () => {
    for (const alt of ['', 'abc', '1e3', '1.2.3', '12 m', '100000.5', '-100001', '--5'])
      expect(bad(format, { alt }), `altitude "${alt}"`).toEqual(['alt']);
  });

  it('several at once, and only those', () => {
    expect(bad(format, { name: '', alt: 'x' })).toEqual(['alt', 'name']);
  });
});

describe('mistakes in the coordinates', () => {
  it('decimal degrees: range, text and empty', () => {
    expect(bad('Deg', { lat: '90' })).toEqual([]);
    expect(bad('Deg', { lat: '-90' })).toEqual([]);
    expect(bad('Deg', { lon: '180' })).toEqual([]);
    expect(bad('Deg', { lon: '-180' })).toEqual([]);
    expect(bad('Deg', { lat: '90.00001' })).toEqual(['lat']);
    expect(bad('Deg', { lat: '-91' })).toEqual(['lat']);
    expect(bad('Deg', { lon: '180.5' })).toEqual(['lon']);
    expect(bad('Deg', { lat: '12abc' })).toEqual(['lat']);
    expect(bad('Deg', { lon: '' })).toEqual(['lon']);
    expect(bad('Deg', { lat: '', lon: '' })).toEqual(['lat', 'lon']);
    expect(bad('Deg', { lat: '1,5', lon: ' 2.5 ' })).toEqual([]);
  });

  it('degrees and minutes: hemisphere, degrees, minutes', () => {
    expect(bad('DegMin', { latD: '90', latM: '0' })).toEqual([]);
    expect(bad('DegMin', { latD: '90', latM: '0.001' })).toEqual(['lat']);
    expect(bad('DegMin', { lonD: '180', lonM: '0' })).toEqual([]);
    expect(bad('DegMin', { lonD: '181' })).toEqual(['lon']);
    expect(bad('DegMin', { latM: '60' })).toEqual(['lat']);
    expect(bad('DegMin', { latM: '59.999' })).toEqual([]);
    expect(bad('DegMin', { latM: '-1' })).toEqual(['lat']);
    expect(bad('DegMin', { latH: 'X' })).toEqual(['lat']);
    expect(bad('DegMin', { latH: 'E' })).toEqual(['lat']); // E is not a latitude
    expect(bad('DegMin', { lonH: 'N' })).toEqual(['lon']);
    expect(bad('DegMin', { latD: '', latM: '' })).toEqual(['lat']);
    expect(bad('DegMin', { latD: '1.5' })).toEqual(['lat']); // whole degrees only
    expect(bad('DegMin', { latD: 'x', lonM: 'y' })).toEqual(['lat', 'lon']);
  });

  it('degrees minutes and seconds: whole minutes, seconds below 60', () => {
    expect(bad('DegMinSec', { latM: '59', latS: '59.9' })).toEqual([]);
    expect(bad('DegMinSec', { latM: '60' })).toEqual(['lat']);
    expect(bad('DegMinSec', { latM: '1.5' })).toEqual(['lat']);
    expect(bad('DegMinSec', { latS: '60' })).toEqual(['lat']);
    expect(bad('DegMinSec', { lonS: '-1' })).toEqual(['lon']);
    expect(bad('DegMinSec', { lonS: '' })).toEqual(['lon']);
    expect(bad('DegMinSec', { latD: '90', latM: '0', latS: '1' })).toEqual(['lat']);
  });

  it('an error names the field and the way out', () => {
    const r = readWaypointInput({ ...GOOD.Deg, lat: '95' }, 'Deg');
    expect(r).toMatchObject({ errors: { lat: 'Latitude should be from -90 to 90 degrees' } });
  });
});
