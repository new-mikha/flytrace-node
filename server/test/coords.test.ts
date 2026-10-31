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

import { describe, expect, it } from 'vitest';
import { coordFields, formatCoord, hemisphereOf, parseCoord } from '../src/geo/coords.ts';

const N = ' ';

describe('formatCoord', () => {
  it('shows decimal degrees with five digits, the sign kept', () => {
    expect(formatCoord(-26.06966, 'lat', 'Deg')).toBe('-26.06966');
    expect(formatCoord(-0.5, 'lat', 'Deg')).toBe('-0.50000');
  });

  it('shows degrees and minutes with a hemisphere', () => {
    expect(formatCoord(-33.313833, 'lat', 'DegMin')).toBe(`S${N}33°${N}18.830'`);
    expect(formatCoord(151.5, 'lon', 'DegMin')).toBe(`E${N}151°${N}30.000'`);
  });

  it('shows degrees minutes and seconds', () => {
    expect(formatCoord(-33.313833, 'lat', 'DegMinSec')).toBe(`S${N}33°${N}18'${N}49.8"`);
  });

  it('carries 59.9996 minutes over to the next degree', () => {
    expect(formatCoord(10 + 59.9996 / 60, 'lat', 'DegMin')).toBe(`N${N}11°${N}00.000'`);
    expect(formatCoord(10 + 59.99 / 3600 + 59 / 60, 'lat', 'DegMinSec')).toBe(
      `N${N}11°${N}00'${N}00.0"`,
    );
  });

  it('keeps the hemisphere of a value between -1 and 0', () => {
    expect(formatCoord(-0.25, 'lon', 'DegMin')).toBe(`W${N}0°${N}15.000'`);
  });
});

describe('coordFields and parseCoord', () => {
  const post = (kind: 'lat' | 'lon', v: number, f: 'Deg' | 'DegMin' | 'DegMinSec') =>
    coordFields(v, kind, f) as Record<string, string>;

  it('keeps the zero after the decimal point (the legacy bug)', () => {
    expect(post('lat', -26.06966, 'Deg')).toEqual({ lat: '-26.06966' });
    const r = parseCoord({ lat: '-26.06966' }, 'lat', 'Deg');
    expect(r).toEqual({ value: -26.06966 });
  });

  it('round-trips through every format', () => {
    for (const v of [-26.06966, -0.25, 0, 0.001, 89.9999, 151.26354, -179.5, 0.00833]) {
      const kind = Math.abs(v) < 90 ? 'lat' : 'lon';
      for (const f of ['Deg', 'DegMin', 'DegMinSec'] as const) {
        const r = parseCoord(post(kind, v, f), kind, f);
        expect('value' in r).toBe(true);
        const tolerance = f === 'Deg' ? 0 : f === 'DegMin' ? 1 / 120000 : 1 / 72000;
        expect(Math.abs((r as { value: number }).value - v)).toBeLessThanOrEqual(tolerance + 1e-12);
      }
    }
  });

  it('reads degrees and minutes typed with a comma, and the hemisphere', () => {
    expect(parseCoord({ latH: 'S', latD: '33', latM: '18,830' }, 'lat', 'DegMin')).toEqual({
      value: -(33 + 18.83 / 60),
    });
    expect(parseCoord({ lonH: 'W', lonD: '0', lonM: '15' }, 'lon', 'DegMin')).toEqual({
      value: -0.25,
    });
  });

  it('refuses what is out of range or not a number', () => {
    expect('error' in parseCoord({ lat: '91' }, 'lat', 'Deg')).toBe(true);
    expect('error' in parseCoord({ lon: '-180.5' }, 'lon', 'Deg')).toBe(true);
    expect('error' in parseCoord({ lat: '12abc' }, 'lat', 'Deg')).toBe(true);
    expect('error' in parseCoord({ lat: '' }, 'lat', 'Deg')).toBe(true);
    expect('error' in parseCoord({ latH: 'N', latD: '10', latM: '60' }, 'lat', 'DegMin')).toBe(
      true,
    );
    expect('error' in parseCoord({ latH: 'N', latD: '90', latM: '30' }, 'lat', 'DegMin')).toBe(
      true,
    );
    expect('error' in parseCoord({ latH: 'X', latD: '1', latM: '1' }, 'lat', 'DegMin')).toBe(true);
    expect(
      'error' in parseCoord({ latH: 'N', latD: '1', latM: '1', latS: '60' }, 'lat', 'DegMinSec'),
    ).toBe(true);
    expect(
      'error' in parseCoord({ latH: 'N', latD: '1.5', latM: '1', latS: '1' }, 'lat', 'DegMinSec'),
    ).toBe(true);
  });

  it('names the hemispheres', () => {
    expect(hemisphereOf(-1, 'lat')).toBe('S');
    expect(hemisphereOf(1, 'lon')).toBe('E');
  });
});
