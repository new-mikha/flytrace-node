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

// The map page, a document of its own (not the usual `Layout` with the menu bar): the script
// `public/js/map/main.js` comes from the legacy site and builds the whole screen in the elements below,
// by their ids and classes. Those are the legacy ones for that reason, not the `ft-` kind; the buttons
// are connected to it by `map-page.js`.

interface MapPageProps {
  groupId: number;
  groupName: string;
  /** Google Maps JavaScript API browser key (`GOOGLE_MAPS_API_KEY`). */
  mapsKey?: string | undefined;
  /** Map ID for the advanced markers (`GOOGLE_MAPS_MAP_ID`). */
  mapId?: string | undefined;
  /** `MapGroup.task`. Fewer than two waypoints are not drawn. */
  task: (string | number)[];
}

/** A value for a script in the page: JSON, with `<` escaped so that it cannot close the script. */
const js = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

export function MapPage({ groupId, groupName, mapsKey, mapId, task }: MapPageProps) {
  // The variables the script reads.
  const globals = `
var _groupId = ${js(groupId)};
var _shouldLog = false;
var _task = ${js(task)};
var _logoSource = '';
var _smallLogoSource = '';
var _ie8_or_less = false;
var _mapId = ${js(mapId ?? '')};`;

  const mapsParams = new URLSearchParams({ libraries: 'marker' });
  if (mapsKey) mapsParams.set('key', mapsKey);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{groupName} - Multi Tracker View</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0"
        />
        <link rel="icon" href="/assets/img/favicon.ico" sizes="any" />
        <link rel="stylesheet" href="/assets/css/map.css" />
        <script dangerouslySetInnerHTML={{ __html: globals }} />
        <script src={`https://maps.googleapis.com/maps/api/js?${mapsParams}`}></script>
        <script src="/vendor/jquery/jquery.min.js"></script>
        <script src="/assets/js/map/labelMapControl.js"></script>
        <script src="/assets/js/map/buttonMapControl.js"></script>
        <script src="/assets/third-party/date.format.js"></script>
        <script src="/assets/js/map/tracker-api.js"></script>
        <script src="/assets/js/map/main.js"></script>
        <script src="/assets/js/map/map-page.js"></script>
      </head>
      <body>
        <div id="header">
          <div id="headerContent">
            <div id="sosList"></div>
            <div id="helpList"></div>
          </div>
          <div id="horSplitter">
            <table>
              <tr>
                <td id="statusLabel">Initializing...</td>
                <td id="errorLabel"></td>
              </tr>
            </table>
          </div>
        </div>
        <div id="content">
          <div id="mapPanel" style="height: 100%; width: 100%"></div>
          <div id="listPanel">
            <div>
              <a href="/">Flytrace</a>&nbsp;&nbsp;
              <input id="ft-update-now" type="button" value="Update Now" />
              <input id="ft-show-map" type="button" value="Show Map" />
            </div>
            <p>
              Coordinates format:
              <select id="coordFormatSelect">
                <option value="deg">DD.DDDDDD&#176;</option>
                <option value="degmin" selected>
                  DD&#176;MM.MMM'
                </option>
                <option value="degminsec">DD&#176;MM'SS.S&quot;</option>
              </select>
              <br />
              The same map with the format above pre-selected:{' '}
              <a id="preFormatLink" href="">
                link
              </a>
            </p>
            <table id="listTable">
              <thead>
                <tr>
                  <td>Tracker</td>
                  <td>Status</td>
                  <td>Coordinates</td>
                  <td>Time</td>
                  <td>Status Age</td>
                </tr>
              </thead>
              <tbody>
                <tr style="display: none">
                  <td>
                    <div class="TrackerNameCtl"></div>
                  </td>
                  <td>
                    <div class="TrackerStatusCtl"></div>
                  </td>
                  <td>
                    <div class="TrackerCoordsCtl"></div>
                  </td>
                  <td>
                    <div class="TrackerTimestampCtl"></div>
                  </td>
                  <td>
                    <div class="TrackerAgeCtl"></div>
                  </td>
                  <td>
                    <div class="TrackerErrorCtl"></div>
                  </td>
                </tr>
              </tbody>
            </table>
            <input id="ft-show-all-tracks" type="button" value="Show All Tracks" />
            <input id="ft-hide-all-tracks" type="button" value="Hide All Tracks" />
            <div style="display: none" id="logDiv"></div>
          </div>
        </div>
      </body>
    </html>
  );
}
