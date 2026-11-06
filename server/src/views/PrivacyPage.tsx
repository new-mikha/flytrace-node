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

import type { CurrentUser } from '../auth/service.ts';
import { Layout } from './Layout.tsx';

/**
 * What the site really does with people's data, in plain words. Change it with the code: a new
 * cookie, a new outside service or a new kind of stored data belongs here, with a new date.
 */
export function PrivacyPage({
  user,
  path,
  contact,
}: {
  user: CurrentUser | null;
  path: string;
  /** `MAIL_CONTACT_ADDRESS`. */
  contact: string;
}) {
  return (
    <Layout title="Privacy policy" user={user} path={path} card="medium">
      <h1 class="h4">Privacy policy</h1>
      <p class="text-body-secondary">Last updated on 7 November 2026.</p>

      <p>
        Flytrace shows the positions of GPS trackers on a map. This page says what it keeps about
        you, why, and what you can do about it. The site has no advertising and does not sell or
        trade anybody's data.
      </p>
      <p>
        The site is run by its owners. For anything about your data, write to{' '}
        <a href={`mailto:${contact}`}>{contact}</a>.
      </p>

      <h2 class="h5 mt-4">If you have an account</h2>
      <p>We keep what the site needs to work for you:</p>
      <ul>
        <li>your user name and email address;</li>
        <li>your password, only as a hash that cannot be turned back into the password;</li>
        <li>the secret and recovery codes of two-factor login, if you turn it on;</li>
        <li>when the account was created and when you last logged in;</li>
        <li>your settings, and the groups, trackers, events and waypoints you create.</li>
      </ul>
      <p>
        Your email address is used for the messages the account needs: confirming the address,
        resetting the password, and the like. They go through an email delivery service.
      </p>

      <h2 class="h5 mt-4">Positions of trackers</h2>
      <p>
        Positions and messages come from the SPOT and Garmin inReach services, through the feeds
        that group owners add. Those services have their own privacy policies. If you add somebody
        else's tracker, make sure they are happy with being shown.
      </p>
      <p>
        We ask for positions only while somebody has a map open. Tracks are held in the memory of
        the server, up to 48 hours back, and are gone about 20 minutes after the last viewer leaves.
        They are not written to the database. The one exception: for each group the database keeps
        its newest position and its time, which the list of public maps goes by.
      </p>
      <p>
        <strong>A map is public.</strong> Anybody with the address of a group's map can see the
        names given to its trackers, their positions, tracks and messages, and that goes for
        unlisted groups too. Public groups can also appear in a list on the home page.
      </p>

      <h2 class="h5 mt-4">Who else sees the data</h2>
      <ul>
        <li>
          <strong>Google Maps.</strong> The map pages load the map and its fonts from Google, so
          Google receives your IP address and what the browser sends with any request. See{' '}
          <a href="https://policies.google.com/privacy">Google's privacy policy</a>.
        </li>
        <li>
          <strong>The site's administrators</strong> can see accounts and groups, to run the site
          and to help when something goes wrong.
        </li>
        <li>
          <strong>The services that run the site</strong>: the hosting and the email delivery.
        </li>
      </ul>

      <h2 class="h5 mt-4">Cookies and logs</h2>
      <p>
        All the cookies are the site's own, and none of them follows you around or is used for
        advertising, so there is nothing to agree to:
      </p>
      <ul>
        <li>
          <code>flytrace.sid</code>: keeps you logged in, for 7 days after your last visit;
        </li>
        <li>
          <code>ft-theme</code>: the day or night theme you chose, for a year;
        </li>
        <li>
          <code>flytrace_coord_format</code> and <code>numAllTracksAlertShown</code>: the
          coordinates format you chose on the map, and that a warning there was already shown, for
          four months.
        </li>
      </ul>
      <p>
        The browser also keeps the scroll position and the position of the map for a moment, in the
        tab, when a page reloads. The server's logs note the pages asked for, with the user name
        when logged in, and what changed in an account. The web server's own logs also hold IP
        addresses. Logs are kept only as long as they are useful for running the site and for
        looking into problems and abuse.
      </p>

      <h2 class="h5 mt-4">Your choices</h2>
      <ul>
        <li>
          Change your details or delete your account in <a href="/settings">Settings</a>. Deleting
          it removes the account with its groups, trackers, events and waypoints. Copies in backups
          go when those backups are replaced.
        </li>
        <li>You can download what we hold about you, also in Settings.</li>
        <li>
          If your tracker or name is on somebody's map and you want it off, ask them, or write to
          us.
        </li>
        <li>
          You can write to us to see, correct or remove your data, and you can complain to the data
          protection authority where you live.
        </li>
      </ul>
    </Layout>
  );
}
