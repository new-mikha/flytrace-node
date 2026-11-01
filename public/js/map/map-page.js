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

// Starts the map page and connects its buttons to the functions of main.js (the legacy script, whose
// functions are global).

(function () {
  function click(id, handler) {
    document.getElementById(id).addEventListener('click', function () {
      handler();
    });
  }

  // The script is in the head of the page, so the buttons are connected once the page has been read:
  document.addEventListener('DOMContentLoaded', function () {
    click('ft-update-now', function () {
      onLookup();
    });
    click('ft-show-map', function () {
      togglePanels();
    });
    click('ft-show-all-tracks', function () {
      showAllTracks();
    });
    click('ft-hide-all-tracks', function () {
      hideAllTracks();
    });

    document.getElementById('coordFormatSelect').addEventListener('change', function (event) {
      changeCoordsFormat(event.target.value);
    });
  });

  // main.js has already asked jQuery to lay the page out when the window has loaded; the map goes in
  // after that, into a panel that has its height by then.
  window.addEventListener('load', function () {
    initialize();
  });
})();
