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

// The same places written in the three formats must come out as the same figure, and a figure must
// be shown in the three formats the way the legacy page showed it.
describe('conversions between the formats', () => {
  type Row = {
    place: string;
    kind: 'lat' | 'lon';
    decimal: number;
    deg: string;
    degMin: Record<string, string>;
    degMinSec: Record<string, string>;
    shown: { Deg: string; DegMin: string; DegMinSec: string };
  };
  const rows: Row[] = [
    {
      place: 'Dalby airfield, latitude',
      kind: 'lat',
      decimal: -(27 + 9 / 60 + 31.9 / 3600),
      deg: '-27.158861',
      degMin: { latH: 'S', latD: '27', latM: '09.532' },
      degMinSec: { latH: 'S', latD: '27', latM: '09', latS: '31.9' },
      shown: {
        Deg: '-27.15886',
        DegMin: `S${N}27°${N}09.532'`,
        DegMinSec: `S${N}27°${N}09'${N}31.9"`,
      },
    },
    {
      place: 'Mt Dare, longitude',
      kind: 'lon',
      decimal: 135.5,
      deg: '135.5',
      degMin: { lonH: 'E', lonD: '135', lonM: '30.000' },
      degMinSec: { lonH: 'E', lonD: '135', lonM: '30', lonS: '00.0' },
      shown: {
        Deg: '135.50000',
        DegMin: `E${N}135°${N}30.000'`,
        DegMinSec: `E${N}135°${N}30'${N}00.0"`,
      },
    },
    {
      place: 'a zero after the decimal point (legacy bug), latitude',
      kind: 'lat',
      decimal: -26.06966,
      deg: '-26.06966',
      degMin: { latH: 'S', latD: '26', latM: '04.180' },
      degMinSec: { latH: 'S', latD: '26', latM: '04', latS: '10.8' },
      shown: {
        Deg: '-26.06966',
        DegMin: `S${N}26°${N}04.180'`,
        DegMinSec: `S${N}26°${N}04'${N}10.8"`,
      },
    },
    {
      place: 'west of Greenwich, just below a degree',
      kind: 'lon',
      decimal: -(0 + 15 / 60),
      deg: '-0.25',
      degMin: { lonH: 'W', lonD: '0', lonM: '15.000' },
      degMinSec: { lonH: 'W', lonD: '0', lonM: '15', lonS: '00.0' },
      shown: {
        Deg: '-0.25000',
        DegMin: `W${N}0°${N}15.000'`,
        DegMinSec: `W${N}0°${N}15'${N}00.0"`,
      },
    },
    {
      place: 'the equator and the prime meridian',
      kind: 'lat',
      decimal: 0,
      deg: '0',
      degMin: { latH: 'N', latD: '0', latM: '0' },
      degMinSec: { latH: 'N', latD: '0', latM: '0', latS: '0' },
      shown: { Deg: '0.00000', DegMin: `N${N}0°${N}00.000'`, DegMinSec: `N${N}0°${N}00'${N}00.0"` },
    },
    {
      place: 'the south pole',
      kind: 'lat',
      decimal: -90,
      deg: '-90',
      degMin: { latH: 'S', latD: '90', latM: '0' },
      degMinSec: { latH: 'S', latD: '90', latM: '0', latS: '0' },
      shown: {
        Deg: '-90.00000',
        DegMin: `S${N}90°${N}00.000'`,
        DegMinSec: `S${N}90°${N}00'${N}00.0"`,
      },
    },
    {
      place: 'the date line',
      kind: 'lon',
      decimal: 180,
      deg: '180',
      degMin: { lonH: 'E', lonD: '180', lonM: '0' },
      degMinSec: { lonH: 'E', lonD: '180', lonM: '0', lonS: '0' },
      shown: {
        Deg: '180.00000',
        DegMin: `E${N}180°${N}00.000'`,
        DegMinSec: `E${N}180°${N}00'${N}00.0"`,
      },
    },
  ];

  for (const r of rows)
    describe(r.place, () => {
      const value = (post: Record<string, string>, f: 'Deg' | 'DegMin' | 'DegMinSec') => {
        const result = parseCoord(post, r.kind, f);
        if (!('value' in result)) throw new Error(result.error);
        return result.value;
      };

      it('reads the same figure from every format', () => {
        // decimal degrees are exact; minutes are typed to 0.001' (about 2 m), seconds to 0.1" (3 m)
        expect(value({ [r.kind]: r.deg }, 'Deg')).toBeCloseTo(r.decimal, 5);
        expect(value(r.degMin, 'DegMin')).toBeCloseTo(r.decimal, 4);
        expect(value(r.degMinSec, 'DegMinSec')).toBeCloseTo(r.decimal, 4);
      });

      it('shows the figure in every format', () => {
        for (const f of ['Deg', 'DegMin', 'DegMinSec'] as const)
          expect(formatCoord(r.decimal, r.kind, f)).toBe(r.shown[f]);
      });

      it('fills the edit fields so that reading them back gives the figure', () => {
        for (const f of ['Deg', 'DegMin', 'DegMinSec'] as const) {
          const back = value(coordFields(r.decimal, r.kind, f) as Record<string, string>, f);
          expect(Math.abs(back - r.decimal)).toBeLessThanOrEqual(
            f === 'Deg' ? 1e-12 : f === 'DegMin' ? 1 / 120000 : 1 / 72000,
          );
        }
      });
    });

  it('a figure shown in one format and typed into another is the same place', () => {
    // 10 deg 59.9996' is 11 deg 00.000' once rounded to the thousandth, never "10 deg 60.000'"
    const f = coordFields(10 + 59.9996 / 60, 'lat', 'DegMin') as Record<string, string>;
    expect(f).toMatchObject({ latD: '11', latM: '00.000' });
  });
});
