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

// Waypoint files: Google Earth (*.KML), SeeYou (*.CUP) and GPS Exchange Format (*.GPX), the formats
// the legacy site loaded (Tools/WaypointsLoader.cs). Each parser returns the waypoints in file order
// ("the order added" is the order of their ids) or throws a WaypointFileError whose message is shown
// to the person. Rules kept from the legacy loader: a waypoint needs a name, a position and an
// altitude; the same name (any case) twice in a file is fine when the values are the same and an
// error when they differ; a GPX waypoint without a name uses its description; the "CIVLID" and
// "COMPID" entries that GPS software adds are ignored.
import { XMLParser } from 'fast-xml-parser';

export interface ParsedWaypoint {
  name: string;
  description: string | null;
  lat: number;
  lon: number;
  /** Meters. */
  alt: number;
}

export class WaypointFileError extends Error {}

export const MAX_NAME_LENGTH = 50;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_FILE_WAYPOINTS = 5000;

export type WaypointFileKind = 'kml' | 'cup' | 'gpx';

export function waypointFileKind(fileName: string): WaypointFileKind | null {
  const ext = /\.([^./\\]*)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  return ext === 'kml' || ext === 'cup' || ext === 'gpx' ? ext : null;
}

export function parseWaypointFile(fileName: string, text: string): ParsedWaypoint[] {
  const kind = waypointFileKind(fileName);
  if (!kind) {
    const ext = /\.([^./\\]*)$/.exec(fileName.trim())?.[0] ?? '';
    throw new WaypointFileError(
      `'${ext}' files are not supported for waypoints upload. Use either Google Earth (*.KML), ` +
        'or SeeYou waypoints (*.CUP), or GPS Exchange Format (*.GPX) files.',
    );
  }
  const clean = text.replace(/^﻿/, '');
  const points =
    kind === 'kml' ? parseKml(clean) : kind === 'gpx' ? parseGpx(clean) : parseCup(clean);
  if (points.length > MAX_FILE_WAYPOINTS)
    throw new WaypointFileError(`The file has more than ${MAX_FILE_WAYPOINTS} waypoints.`);
  return points;
}

// ---- shared pieces

/** What the legacy `Global.ToDouble` accepted: a plain decimal number, point as the separator. */
function toNumber(raw: string): number {
  const s = raw.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s))
    throw new WaypointFileError(`Can't read '${raw.trim()}' as a number`);
  return Number(s);
}

/** Checks one waypoint and adds it, or skips an exact repeat of one already read (any case). */
function add(
  out: ParsedWaypoint[],
  seen: Map<string, ParsedWaypoint>,
  w: { name: string; description: string | null; lat: number; lon: number; alt: number },
): void {
  const name = w.name.trim();
  const fail = (message: string): never => {
    throw new WaypointFileError(`Problem with ${name || 'a waypoint'}: ${message}`);
  };
  if (name === '') fail('the name is empty');
  if (name.length > MAX_NAME_LENGTH) fail(`the name is longer than ${MAX_NAME_LENGTH} characters`);
  const description = w.description?.trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH)
    fail(`the description is longer than ${MAX_DESCRIPTION_LENGTH} characters`);
  if (!(w.lat >= -90 && w.lat <= 90)) fail(`latitude ${w.lat} is out of range`);
  if (!(w.lon >= -180 && w.lon <= 180)) fail(`longitude ${w.lon} is out of range`);
  const earlier = seen.get(name.toLowerCase());
  if (earlier) {
    if (earlier.lat !== w.lat || earlier.lon !== w.lon || earlier.alt !== w.alt)
      fail('There are two rows with same name but different values in the file.');
    return;
  }
  const point = { name, description, lat: w.lat, lon: w.lon, alt: w.alt };
  seen.set(name.toLowerCase(), point);
  out.push(point);
}

// ---- XML (KML and GPX)

type XmlNode = { [tag: string]: XmlNode[] | string } & { ':@'?: Record<string, string> };

const xml = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function parseXml(text: string): XmlNode[] {
  try {
    return xml.parse(text, true) as XmlNode[];
  } catch (err) {
    throw new WaypointFileError(`The file is not valid XML: ${(err as Error).message}`);
  }
}

const tagOf = (n: XmlNode): string => Object.keys(n).find((k) => k !== ':@' && k !== '#text') ?? '';
const childrenOf = (n: XmlNode): XmlNode[] => {
  const tag = tagOf(n);
  const v = tag ? n[tag] : undefined;
  return Array.isArray(v) ? v : [];
};

/** The text directly inside an element (comments and child elements left out). */
function textOf(children: XmlNode[]): string {
  return children
    .map((c) => (typeof c['#text'] === 'string' ? c['#text'] : ''))
    .join('')
    .trim();
}

/** Every element called `tag`, anywhere below `nodes`, in document order. */
function findAll(nodes: XmlNode[], tag: string, out: XmlNode[] = []): XmlNode[] {
  for (const n of nodes)
    if (tagOf(n) === tag) out.push(n);
    else findAll(childrenOf(n), tag, out);

  return out;
}

const firstChild = (n: XmlNode, tag: string): XmlNode | undefined =>
  childrenOf(n).find((c) => tagOf(c) === tag);

// ---- KML

function parseKml(text: string): ParsedWaypoint[] {
  const out: ParsedWaypoint[] = [];
  const seen = new Map<string, ParsedWaypoint>();
  for (const placemark of findAll(parseXml(text), 'Placemark')) {
    const nameNode = firstChild(placemark, 'name');
    const name = nameNode ? textOf(childrenOf(nameNode)) : null;
    const label = name || 'a Placemark';
    try {
      if (name === null)
        throw new WaypointFileError('At least one required value is absent (name)');
      const descNode = firstChild(placemark, 'description');
      const coordinates = findAll(childrenOf(placemark), 'coordinates');
      if (coordinates.length === 0)
        throw new WaypointFileError('At least one required value is absent (coordinates)');
      if (coordinates.length > 1)
        throw new WaypointFileError('It has more than one <coordinates> element.');
      const parts = textOf(childrenOf(coordinates[0]!)).split(',');
      if (parts.length < 3)
        throw new WaypointFileError(
          'The coordinates must be "longitude,latitude,altitude" (a single point).',
        );
      add(out, seen, {
        name,
        description: descNode ? textOf(childrenOf(descNode)) : null,
        lon: toNumber(parts[0]!),
        lat: toNumber(parts[1]!),
        alt: toNumber(parts[2]!),
      });
    } catch (err) {
      throw withName(err, label);
    }
  }
  return out;
}

/** "Problem with X: ..." unless the message already starts like that. */
function withName(err: unknown, label: string): Error {
  if (!(err instanceof WaypointFileError)) return err as Error;
  return err.message.startsWith('Problem with ')
    ? err
    : new WaypointFileError(`Problem with ${label}: ${err.message}`);
}

// ---- GPX

const IGNORABLE = /^(CIVLID\s\d+#CIV|COMPID\s\d+#COM)/;

function parseGpx(text: string): ParsedWaypoint[] {
  const out: ParsedWaypoint[] = [];
  const seen = new Map<string, ParsedWaypoint>();
  for (const wpt of findAll(parseXml(text), 'wpt')) {
    const nameNode = firstChild(wpt, 'name');
    const descNode = firstChild(wpt, 'desc');
    const eleNode = firstChild(wpt, 'ele');
    const description = descNode ? textOf(childrenOf(descNode)) : null;
    let name = nameNode ? textOf(childrenOf(nameNode)) : null;
    if (!name?.trim()) name = description;
    const label = name || 'a waypoint';
    try {
      const attrs = wpt[':@'] ?? {};
      if (name === null || attrs.lat === undefined || attrs.lon === undefined || !eleNode)
        throw new WaypointFileError(
          'At least one required value is absent (name, lat, lon or ele)',
        );
      if (IGNORABLE.test(`${name}#${description ?? ''}`)) continue;
      const eleText = textOf(childrenOf(eleNode));
      add(out, seen, {
        name,
        description,
        lat: toNumber(attrs.lat),
        lon: toNumber(attrs.lon),
        alt: eleText === '' ? 0 : toNumber(eleText),
      });
    } catch (err) {
      throw withName(err, label);
    }
  }
  return out;
}

// ---- CUP (see http://download.naviter.com/docs/cup_format.pdf)

/** A line of comma separated values; commas inside double quotes belong to the value. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/** "227.0m" or "745f" to meters. */
function cupAltitude(raw: string): number {
  const s = raw.trim();
  const unit = s.slice(-1).toLowerCase();
  if (unit !== 'm' && unit !== 'f')
    throw new WaypointFileError(
      `Elevation '${s}' doesn't end with a correct unit symbol ('m' or 'f')`,
    );
  return toNumber(s.slice(0, -1)) * (unit === 'f' ? 0.3048 : 1);
}

/** "3318.830S": degrees and minutes together (ddmm.mmm), then the hemisphere. */
function cupCoordinate(raw: string, neg: string, pos: string, maxDegrees: number): number {
  const s = raw.trim();
  const hemisphere = s.slice(-1).toUpperCase();
  if (hemisphere !== neg && hemisphere !== pos)
    throw new WaypointFileError(
      `Coordinate '${s}' doesn't end with a correct hemisphere symbol ('${neg}' or '${pos}')`,
    );
  const value = toNumber(s.slice(0, -1)); // 3318.830
  if (value < 0)
    throw new WaypointFileError(`Invalid coordinate format in '${s}' (negative value)`);
  const whole = Math.floor(value);
  const fraction = value - whole; // .830
  const degrees = Math.floor(whole / 100); // 33
  const minutes = (whole % 100) + fraction; // 18.830
  if (degrees > maxDegrees)
    throw new WaypointFileError(`Invalid coordinate format in '${s}' (degrees value too large)`);
  if (minutes > 60)
    throw new WaypointFileError(`Invalid coordinate format in '${s}' (minutes value too large)`);
  return (hemisphere === neg ? -1 : 1) * (degrees + minutes / 60);
}

function parseCup(text: string): ParsedWaypoint[] {
  const out: ParsedWaypoint[] = [];
  const seen = new Map<string, ParsedWaypoint>();
  let first = true;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() === '') continue;
    if (line.startsWith('---')) break; // the waypoints end here; a task section may follow
    try {
      const f = splitCsv(line);
      if (f.length < 11) throw new WaypointFileError('Unexpected number of elements');
      const longName = f[0]!.trim();
      const code = f[1]!.trim();
      add(out, seen, {
        name: code || longName,
        description: longName,
        lat: cupCoordinate(f[3]!, 'S', 'N', 90),
        lon: cupCoordinate(f[4]!, 'W', 'E', 180),
        alt: cupAltitude(f[5]!),
      });
    } catch (err) {
      // The first line may be a header ("name,code,country,lat,..."): it is skipped when it fails.
      if (first && err instanceof WaypointFileError) {
        first = false;
        continue;
      }
      if (!(err instanceof WaypointFileError)) throw err;
      const shown = line.length > 120 ? `${line.slice(0, 118)}...` : line;
      throw new WaypointFileError(`${err.message}\nProblem found in line:\n${shown}`);
    }
    first = false;
  }
  return out;
}
