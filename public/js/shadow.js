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

// Scroll shadow: with no scroll bars to look at, a soft strip under the sticky bars says "there is more above" and a strip at the
// bottom of the screen says "there is more below". Each is invisible at its end of the page and reaches full strength after
// `--ft-shadow-ramp` of scrolling (all the settings are in flytrace.css). The two strips hang from sticky anchors in the page
// (Layout `shadow`), so they move with the sticky bars when the page is pulled past its end; this script only says where the top
// strip starts and how strong each is.
(() => {
  const anchor = document.querySelector('.ft-shadow-top');
  const top = anchor?.querySelector('.ft-shadow-strip');
  const bottom = document.querySelector('.ft-shadow-bottom .ft-shadow-strip');
  const frame = document.querySelector('.ft-navbar');
  if (!anchor || !top || !bottom || !frame) return;

  // Everything that sticks at the top of the screen. The shadow starts under the lowest one that is stuck right now: the menu bar, then
  // the section title, the search and sort rows, the column header of a table (each sticks at its own `top`).
  const STICKY =
    '.ft-navbar, .ft-section-title, .ft-sticky-head thead, .ft-search, .ft-pager-bar, .ft-sort-bar';
  const clamp = (n) => Math.min(1, Math.max(0, n));
  const px = (value) =>
    /rem\s*$/.test(value)
      ? parseFloat(value) * parseFloat(getComputedStyle(document.documentElement).fontSize)
      : parseFloat(value);
  let queued = false;

  function update() {
    queued = false;
    const ramp = Math.max(1, px(getComputedStyle(top).getPropertyValue('--ft-shadow-ramp')) || 32);
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - document.documentElement.clientHeight; // not innerHeight: that one moves with a phone's address bar

    const box = frame.getBoundingClientRect();
    let edge = Math.max(0, box.bottom); // never above the menu bar, even before it sticks (on wide screens there is a gap above it)
    for (const el of document.querySelectorAll(STICKY)) {
      if (el.getClientRects().length === 0) continue; // not shown at this width
      const rect = el.getBoundingClientRect();
      if (rect.top <= parseFloat(getComputedStyle(el).top) + 1 && rect.bottom > edge)
        edge = rect.bottom; // stuck, or being pushed out
    }

    top.style.top = `${edge - anchor.getBoundingClientRect().top}px`; // from the anchor, which sticks to the top of the screen like the bars
    top.style.opacity = String(clamp(y / ramp));
    bottom.style.opacity = String(max - y < 1 ? 0 : clamp((max - y) / ramp)); // exactly at the end: gone
  }

  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
})();
