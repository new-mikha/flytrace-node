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

// Group editor: while the person types the tracker link, the SPOT / inReach choice follows it (until they pick one themselves).
(() => {
  const form = document.getElementById('ft-add-tracker');
  const link = form?.querySelector('input[name="link"]');
  const radios = form ? [...form.querySelectorAll('input[name="type"]')] : [];
  if (!link || radios.length === 0) return;
  let chosenByHand = radios.some((r) => r.checked);

  const SPOT = /^\s*(?:(?:https?:\/\/)?share\.findmespot\.com\/shared\/faces\/viewspots\.jsp\?glId=)?[^\s\\/?=&#]{20,50}\s*$/i;
  const guess = (text) => (/garmin\.com|#/i.test(text) ? 'G' : SPOT.test(text) ? 'S' : /\S/.test(text) ? 'G' : null);

  for (const r of radios) r.addEventListener('change', () => { chosenByHand = true; });
  link.addEventListener('input', () => {
    if (chosenByHand) return;
    const type = guess(link.value);
    for (const r of radios) r.checked = r.value === type;
  });
})();
