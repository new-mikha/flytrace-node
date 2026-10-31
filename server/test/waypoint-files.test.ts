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

// The KML, CUP and GPX waypoint parsers (rules of the legacy WaypointsLoader).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  parseWaypointFile,
  WaypointFileError,
  waypointFileKind,
} from '../src/repo/waypointFiles.ts';

const fails = (file: string, text: string) => {
  try {
    parseWaypointFile(file, text);
  } catch (err) {
    expect(err).toBeInstanceOf(WaypointFileError);
    return (err as Error).message;
  }
  throw new Error('did not fail');
};

describe('waypointFileKind', () => {
  it('goes by the extension, any case', () => {
    expect(waypointFileKind('Comp.KML')).toBe('kml');
    expect(waypointFileKind('a.b.cup')).toBe('cup');
    expect(waypointFileKind('x.GPX')).toBe('gpx');
    expect(waypointFileKind('x.txt')).toBeNull();
    expect(waypointFileKind('noext')).toBeNull();
  });
});

describe('KML', () => {
  const kml = (placemarks: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder>${placemarks}</Folder></Document></kml>`;

  it('reads placemarks in file order, with name, description and "lon,lat,alt"', () => {
    const points = parseWaypointFile(
      'a.kml',
      kml(`
        <Placemark><name> ZULU </name><description><![CDATA[Last <b>letter</b>]]></description>
          <Point><coordinates>150.5,-30.25,120.5</coordinates></Point></Placemark>
        <Placemark><name>alpha</name><Point><coordinates> 151 , -31 , 0 </coordinates></Point></Placemark>`),
    );
    expect(points).toEqual([
      { name: 'ZULU', description: 'Last <b>letter</b>', lat: -30.25, lon: 150.5, alt: 120.5 },
      { name: 'alpha', description: null, lat: -31, lon: 151, alt: 0 },
    ]);
  });

  it('understands a namespace prefix', () => {
    const text =
      '<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Placemark><k:name>P</k:name><k:Point><k:coordinates>1,2,3</k:coordinates></k:Point></k:Placemark></k:kml>';
    expect(parseWaypointFile('a.kml', text)).toEqual([
      { name: 'P', description: null, lat: 2, lon: 1, alt: 3 },
    ]);
  });

  it('skips a repeat with the same values (any case) and refuses one with different values', () => {
    const one = (name: string, alt: number) =>
      `<Placemark><name>${name}</name><Point><coordinates>1,2,${alt}</coordinates></Point></Placemark>`;
    expect(parseWaypointFile('a.kml', kml(one('A', 5) + one('a', 5)))).toHaveLength(1);
    expect(fails('a.kml', kml(one('A', 5) + one('a', 6)))).toContain(
      'two rows with same name but different values',
    );
  });

  it('says which placemark is wrong and why', () => {
    const noCoords = '<Placemark><name>X</name></Placemark>';
    expect(fails('a.kml', kml(noCoords))).toBe(
      'Problem with X: At least one required value is absent (coordinates)',
    );
    const noName = '<Placemark><Point><coordinates>1,2,3</coordinates></Point></Placemark>';
    expect(fails('a.kml', kml(noName))).toContain('(name)');
    const line =
      '<Placemark><name>Track</name><LineString><coordinates>1,2,3 4,5,6</coordinates></LineString></Placemark>';
    expect(fails('a.kml', kml(line))).toContain('Problem with Track');
    const bad =
      '<Placemark><name>B</name><Point><coordinates>1,x,3</coordinates></Point></Placemark>';
    expect(fails('a.kml', kml(bad))).toBe("Problem with B: Can't read 'x' as a number");
    const far =
      '<Placemark><name>F</name><Point><coordinates>1,95,3</coordinates></Point></Placemark>';
    expect(fails('a.kml', kml(far))).toContain('latitude 95 is out of range');
    const long = `<Placemark><name>${'N'.repeat(MAX_NAME_LENGTH + 1)}</name><Point><coordinates>1,2,3</coordinates></Point></Placemark>`;
    expect(fails('a.kml', kml(long))).toContain('the name is longer than 50 characters');
  });

  it('refuses a file that is not XML, and finds nothing in a file without placemarks', () => {
    expect(fails('a.kml', '<kml><Placemark>')).toContain('not valid XML');
    expect(parseWaypointFile('a.kml', '<kml></kml>')).toEqual([]);
  });
});

describe('GPX', () => {
  const gpx = (wpts: string) =>
    `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${wpts}</gpx>`;

  it('reads wpt elements: lat and lon are attributes, name, desc and ele are children', () => {
    const points = parseWaypointFile(
      'a.gpx',
      gpx(`
        <wpt lat="-33.5" lon="150.25"><ele>227.5</ele><name>JONNY</name><desc>field</desc></wpt>
        <wpt lat="1" lon="2"><ele></ele><name>EMPTYELE</name></wpt>
        <rte><rtept lat="9" lon="9"><name>NOTAWAYPOINT</name></rtept></rte>`),
    );
    expect(points).toEqual([
      { name: 'JONNY', description: 'field', lat: -33.5, lon: 150.25, alt: 227.5 },
      { name: 'EMPTYELE', description: null, lat: 1, lon: 2, alt: 0 },
    ]);
  });

  it('uses the description when there is no name, and ignores the CIVL and COMPID entries', () => {
    const points = parseWaypointFile(
      'a.gpx',
      gpx(`
        <wpt lat="1" lon="2"><ele>3</ele><desc>Only a description</desc></wpt>
        <wpt lat="1" lon="2"><ele>3</ele><name>CIVLID 1234</name><desc>CIV</desc></wpt>
        <wpt lat="1" lon="2"><ele>3</ele><name>COMPID 99</name><desc>COM</desc></wpt>`),
    );
    expect(points.map((p) => p.name)).toEqual(['Only a description']);
  });

  it('refuses a waypoint without an elevation, or with a bad position', () => {
    expect(fails('a.gpx', gpx('<wpt lat="1" lon="2"><name>NOELE</name></wpt>'))).toBe(
      'Problem with NOELE: At least one required value is absent (name, lat, lon or ele)',
    );
    expect(fails('a.gpx', gpx('<wpt lat="abc" lon="2"><ele>1</ele><name>BAD</name></wpt>'))).toBe(
      "Problem with BAD: Can't read 'abc' as a number",
    );
  });
});

describe('CUP', () => {
  const header = 'name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc';

  it('reads ddmm.mmmH coordinates and m / f elevations, skips a header line and stops at "---"', () => {
    const points = parseWaypointFile(
      'a.cup',
      [
        header,
        '"Jonny Field",JONNY,,3318.830S,14750.088E,227.0m,1,,,,"next to Burrawang Rd"',
        '"Hill",HILL,AU,0030.000N,00130.000W,1000f,1,,,,',
        '',
        '-----Related Tasks-----',
        '"Task 1","START","JONNY"',
      ].join('\r\n'),
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.name).toBe('JONNY');
    expect(points[0]!.description).toBe('Jonny Field');
    expect(points[0]!.lat).toBeCloseTo(-(33 + 18.83 / 60), 9);
    expect(points[0]!.lon).toBeCloseTo(147 + 50.088 / 60, 9);
    expect(points[0]!.alt).toBe(227);
    expect(points[1]).toMatchObject({ name: 'HILL', lat: 0.5, lon: -1.5 });
    expect(points[1]!.alt).toBeCloseTo(304.8, 6);
  });

  it('uses the long name when the code is empty, and keeps commas inside quotes', () => {
    const points = parseWaypointFile(
      'a.cup',
      '"Smith, John\'s field",,,3318.830S,14750.088E,10m,1,,,,"a, b"',
    );
    expect(points[0]).toMatchObject({
      name: "Smith, John's field",
      description: "Smith, John's field",
    });
  });

  it('shows the bad line with the reason', () => {
    const message = fails('a.cup', `${header}\n"A",A,,3318.830X,14750.088E,227.0m,1,,,,\n`);
    expect(message).toContain(
      "Coordinate '3318.830X' doesn't end with a correct hemisphere symbol",
    );
    expect(message).toContain('Problem found in line:\n"A",A,,3318.830X');
    // a bad first line is taken for a header and skipped, so these come after a good line:
    const good = '"G",G,,3318.830S,14750.088E,1m,1,,,,';
    const after = (line: string) => fails('a.cup', `${good}\n${line}`);
    expect(after('"A",A,,3318.830S,14750.088E,227,1,,,,')).toContain("Elevation '227'");
    expect(after('a,b,c')).toContain('Unexpected number of elements');
    expect(after('"A",A,,9100.000N,14750.088E,1m,1,,,,')).toContain('degrees value too large');
    expect(after('"A",A,,3375.000N,14750.088E,1m,1,,,,')).toContain('minutes value too large');
    expect(parseWaypointFile('a.cup', 'a,b,c')).toEqual([]); // only a "header"
  });
});

describe('any file', () => {
  it('names the unsupported extension', () => {
    expect(fails('x.txt', '')).toContain("'.txt' files are not supported");
  });
});

// Real files: the Dalby 2024 waypoints exported from GpsDump (GPX) and SeeYou (CUP), and the
// Forbes 2024 ones (GPX). The two Dalby files describe the same 173 points.
const sample = (name: string) =>
  readFileSync(new URL(`./fixtures/waypoints/${name}`, import.meta.url), 'utf8');

describe('real files', () => {
  const cup = parseWaypointFile('Dalby2024.cup', sample('Dalby2024.cup'));
  const gpx = parseWaypointFile('Dalby2024.gpx', sample('Dalby2024.gpx'));

  it('reads the CUP file (its first line is a header) and the GPX file', () => {
    expect(cup).toHaveLength(173);
    expect(gpx).toHaveLength(173);
    expect(cup[0]).toMatchObject({ name: '0DALBY', description: '0DALBY' });
    expect(cup.at(-1)!.name).toBe('YOULEB');
    expect(gpx[0]).toMatchObject({ name: '0DALBY', lat: -27.158867, lon: 151.263783, alt: 351 });
  });

  it('finds the same waypoints in both, in the same order, at the same places', () => {
    expect(cup.map((w) => w.name)).toEqual(gpx.map((w) => w.name));
    cup.forEach((w, i) => {
      // GPX has 6 decimals, CUP thousandths of a minute (about 2 m); GPX altitudes are whole meters
      expect(Math.abs(w.lat - gpx[i]!.lat), w.name).toBeLessThan(0.0001);
      expect(Math.abs(w.lon - gpx[i]!.lon), w.name).toBeLessThan(0.0001);
      expect(Math.abs(w.alt - gpx[i]!.alt), w.name).toBeLessThan(1);
    });
    expect(cup[0]!.lat).toBeCloseTo(-(27 + 9.532 / 60), 9);
    expect(cup[0]!.lon).toBeCloseTo(151 + 15.827 / 60, 9);
  });

  it('reads the Forbes GPX file', () => {
    const forbes = parseWaypointFile('Forbes 24.gpx', sample('Forbes24.gpx'));
    expect(forbes).toHaveLength(164);
    expect(forbes[0]).toMatchObject({ name: '4WAYS', lat: -32.4916, lon: 147.919733, alt: 222 });
    expect(new Set(forbes.map((w) => w.name.toLowerCase())).size).toBe(164);
  });
});

describe('the 2016 Dalby KML file', () => {
  // An old file (other names than the 2024 ones, and it has COMPID and CIVLID placemarks, which only
  // the GPX rules ignore), written by GpsDump with a KML 2.1 namespace.
  const kml = parseWaypointFile('dalby2016.kml', sample('dalby2016.kml'));

  it('reads all 174 placemarks in file order, with the code as the description', () => {
    expect(kml).toHaveLength(174);
    expect(kml[0]).toEqual({
      name: 'BRAEUN',
      description: 'BRA055',
      lat: 47.829418,
      lon: 11.127816,
      alt: 550,
    });
    expect(kml[1]).toMatchObject({ name: '1DALBY', lat: -27.158866, lon: 151.263785, alt: 351 });
  });

  it('keeps a zero right after the decimal point (a legacy bug report: "Mt Dare" at -26.06966)', () => {
    // The legacy edit form dropped that zero (-26.6966), which broke the map. Reading is exact:
    const byName = new Map(kml.map((w) => [w.name, w]));
    expect(byName.get('BYMONT')).toMatchObject({ lat: -26.065784 }); // -26.0|65784
    expect(byName.get('ASHFRD')).toMatchObject({ lon: 151.088867 }); // 151.0|88867
    expect(
      parseWaypointFile(
        'a.kml',
        '<kml><Placemark><name>Mt Dare</name><Point><coordinates>135.2,-26.06966,100</coordinates></Point></Placemark></kml>',
      )[0],
    ).toMatchObject({ lat: -26.06966, lon: 135.2 });
  });
});
