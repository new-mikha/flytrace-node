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

// The map page's two requests to the server, which main.js makes through this object. In the legacy
// site they went through the ASP.NET AJAX proxy of a web service (`FlyTrace.Service.TrackerService`);
// here they are plain `fetch` calls, and the answer is handed to the same callbacks as before.

var TrackerApi = (function () {
  // Dates travel as ISO 8601 text (what `JSON.stringify` makes of a Date), and main.js wants dates:
  var ISO_DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

  function reviveDates(key, value) {
    return typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : value;
  }

  // `onSuccess` gets the answer; `onError` gets whatever went wrong on the way (no connection, a
  // refusal), but not what `onSuccess` itself throws.
  function send(url, options, onSuccess, onError) {
    fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options))
      .then(function (response) {
        if (!response.ok) throw new Error('The server answered ' + response.status + '.');
        return response.text();
      })
      .then(function (text) {
        return JSON.parse(text, reviveDates);
      })
      .then(onSuccess, onError);
  }

  return {
    // The latest position of every tracker of the group: always all of them.
    getCoordinates: function (groupId, onSuccess, onError) {
      send('/map/' + groupId + '/coordinates', {}, onSuccess, onError);
    },

    // The tracks of the trackers named in `request.Items` (up to 10), newer than their `LaterThan`.
    getTracks: function (groupId, request, onSuccess, onError) {
      send(
        '/map/' + groupId + '/tracks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
        onSuccess,
        onError,
      );
    },

    // The legacy site collected the script's log (the "send log" button, only there when logging is
    // on); now it stays in the browser's console.
    testCheck: function (message) {
      console.warn(message);
    },
  };
})();
