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

import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import { Nav } from './Nav.tsx';

interface LayoutProps {
  title: string;
  user: CurrentUser | null;
  path: string;
  /** Floating card (with shadow) instead of the plain panel: small, 'medium' (account pages), or 'wide' = as wide as the menu bar. Phones show a plain panel. */
  card?: boolean | 'medium' | 'wide';
  /** Extra scripts (paths under /assets/js/) for this page only. */
  scripts?: string[];
  /** Scroll fog: soft strips under the sticky bars and at the bottom of the screen that show there is more to scroll (public/js/fog.js). */
  fog?: boolean;
  children: ComponentChildren;
}

/** Page frame shared by every page: background, navigation bar and the "jumbotron" content panel. */
export function Layout({ title, user, path, card, scripts, fog, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} - Flytrace`}</title>
        <link rel="icon" href="/assets/img/favicon.ico" sizes="any" />
        <link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css" />
        <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css" />
        <link rel="stylesheet" href="/assets/css/flytrace.css" />
      </head>
      <body>
        <div class="ft-progress" id="ft-progress" aria-hidden="true"><div class="ft-progress-bar"></div></div>
        <div class="ft-bg">
          <div class="ft-frame">
            <Nav user={user} path={path} />
            <main class={card ? `ft-jumbotron ft-jumbotron-card${card === 'wide' ? ' ft-jumbotron-wide' : card === 'medium' ? ' ft-jumbotron-medium' : ''}` : 'ft-jumbotron'}>{children}</main>
          </div>
        </div>
        {fog && (
          <>
            <div class="ft-fog ft-fog-top" aria-hidden="true"></div>
            <div class="ft-fog ft-fog-bottom" aria-hidden="true"></div>
          </>
        )}
        <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js" defer></script>
        <script src="/assets/js/app.js" defer></script>
        {fog && <script src="/assets/js/fog.js" defer></script>}
        {scripts?.map((src) => <script src={`/assets/js/${src}`} defer></script>)}
      </body>
    </html>
  );
}
