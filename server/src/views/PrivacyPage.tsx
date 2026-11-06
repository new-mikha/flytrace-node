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
        Flytrace shows the positions of GPS trackers on a map. This page says what we keep, why, for
        how long, and what you can do about it. We have no advertising, and we do not sell or trade
        anybody's data.
      </p>
      <p>
        Flytrace is run by its owners in Australia. The data is stored on a server in the EU and is
        looked after from Australia. For anything about your data, write to{' '}
        <a href={`mailto:${contact}`}>{contact}</a>.
      </p>

      <h2 class="h5 mt-4">If you have an account</h2>
      <p>We keep what the site needs to work for you:</p>
      <ul>
        <li>your user name and email address;</li>
        <li>your password, as a hash and never as plain text;</li>
        <li>the secret and recovery codes of two-factor login, if you turn it on;</li>
        <li>when the account was created and when you last logged in;</li>
        <li>
          your settings, and the groups, events and waypoints you create, with the names and feed
          addresses of your trackers (for inReach that can include the device's IMEI number).
        </li>
      </ul>
      <p>
        We use your email address only for the messages the account needs: confirming the address,
        resetting the password, and the like. Accounts from the old Flytrace site were carried over
        to this one.
      </p>
      <p>
        We keep your account until you delete it or ask us to. We do not remove accounts for being
        inactive: your groups and the links to their maps stay as they were when you come back.
      </p>

      <h2 class="h5 mt-4">Positions of trackers</h2>
      <p>
        Positions, altitudes and messages come from the SPOT and Garmin inReach services, through
        the feeds that group owners add. Those services have their own privacy policies. We read a
        feed once when a tracker is added, and after that only while somebody has a map open.
      </p>
      <p>
        Tracks are held in the memory of the server, up to 48 hours back, and are gone about 20
        minutes after the last viewer leaves. They are not written to the database. The one
        exception: for each group the database keeps its newest position and its time, which the
        list of public maps goes by.
      </p>
      <p>
        <strong>A map is public.</strong> Anybody with the address of a group's map can see the
        names given to its trackers, their positions, tracks and messages, and that goes for
        unlisted groups too. Public groups can also appear in a list on the home page.
      </p>
      <p>
        <strong>If you are on a map without having an account here:</strong> your name and position
        got here because a group owner added your tracker. If you add somebody else's tracker, you
        must have their agreement. If you want to be taken off a map, ask the group's owner or write
        to us.
      </p>

      <h2 class="h5 mt-4">Why we may use this data</h2>
      <ul>
        <li>Your account and your groups: to give you the service you signed up for.</li>
        <li>
          Showing trackers on a map: the legitimate interest of pilots, their teams and their
          followers in following a flight, and in finding a pilot who needs help.
        </li>
        <li>Logs: our legitimate interest in keeping the site running and secure.</li>
      </ul>

      <h2 class="h5 mt-4">Who else sees the data</h2>
      <ul>
        <li>
          <strong>Google Maps.</strong> Map pages load the map and its fonts from Google, in the
          USA, so Google receives your IP address and the area of the map you look at. See{' '}
          <a href="https://policies.google.com/privacy">Google's privacy policy</a>.
        </li>
        <li>
          <strong>Administrators, and a few people they trust,</strong> can see accounts or groups,
          to run the site and to help when something goes wrong.
        </li>
        <li>
          <strong>The services that run the site:</strong> the hosting, and the delivery of email.
        </li>
      </ul>
      <p>
        Because the site is looked after from Australia and uses Google, your data can leave your
        country and the EU.
      </p>

      <h2 class="h5 mt-4">Cookies and logs</h2>
      <p>All the cookies are our own. None is used for advertising or to follow you elsewhere:</p>
      <ul>
        <li>
          <code>flytrace.sid</code>: keeps you logged in, and carries you through the login and its
          messages, for 7 days after your last visit;
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
        tab, when a page reloads.
      </p>
      <p>
        Our logs note the pages asked for, with the user name when logged in, what changed in an
        account, and which tracker feeds were read. They hold IP addresses too: for failed logins,
        and in the web server's own logs. Logs are kept for 90 days.
      </p>

      <h2 class="h5 mt-4">Your choices</h2>
      <ul>
        <li>
          Change your details, download your data or delete your account in{' '}
          <a href="/settings">Settings</a>. The download holds your account, settings, groups,
          trackers, events, waypoints and tasks.
        </li>
        <li>
          Deleting your account removes it with all of that at once. Some traces last a little
          longer: your user name in the logs for up to 90 days, a tracker in memory for up to 20
          minutes, the time a feed was last read until the server next restarts, and copies in
          backups until those backups are replaced.
        </li>
        <li>
          You can write to us to see, correct or remove your data, to limit how we use it, or to
          object to it. You can also complain to the data protection authority where you live.
        </li>
      </ul>

      <h2 class="h5 mt-4">Changes to this page</h2>
      <p>When this page changes, the date at the top changes with it.</p>
    </Layout>
  );
}
