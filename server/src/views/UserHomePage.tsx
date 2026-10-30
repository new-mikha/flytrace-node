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
import type { UserEventsList } from '../repo/events.ts';
import type { PublicGroupsList, UserGroupsList } from '../repo/groups.ts';
import { ConfirmDialog } from './confirmDelete.tsx';
import { MoreMaps } from './HomePage.tsx';
import { Alert, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';
import { PublicGroupsTable } from './PublicGroupsTable.tsx';
import { UserEventsTable } from './UserEventsTable.tsx';
import { UserGroupsTable } from './UserGroupsTable.tsx';

/** The home page of a signed-in user. Their pilot groups, and their events when they use the multiple-events mode. */
export function UserHomePage({ user, path, list, events, others, now, flash }: {
  user: CurrentUser; path: string; list: UserGroupsList; events: UserEventsList; now: Date; flash?: Flash | null;
  /** Other people's groups, when "Show others' groups" is on (`/?others=1`). */
  others?: { list: PublicGroupsList; showAll: boolean } | null;
}) {
  const admin = user.roles.includes('Admins');
  const what = admin ? "others' groups" : "others' public groups"; // admins also get the unlisted ones
  return (
    <Layout title="Home" user={user} path={path} card="wide" scripts={list.groups.length > 0 ? ['confirm-dialog.js'] : undefined}>
      <Alert flash={flash} />
      {list.groups.length > 0 && <ConfirmDialog />}
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> My pilot groups</h5>
        <UserGroupsTable list={list} now={now} admin={user.roles.includes('Admins')} />
        <form class="mt-3 mb-0" method="post" action="/groups">
          <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Create new group</button>
        </form>
      </section>
      {!events.show && (
        <p class="small text-body-secondary mt-3 mb-0">
          Events: choose Multiple Events Mode in <a href="/settings/events-mode">Settings</a> to manage several events.
        </p>
      )}
      {events.show && (
        <section class="ft-section">
          <h5 class="ft-section-title"><i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> My events</h5>
          <p class="text-body-secondary">You can set up events here to show tasks on your public maps.</p>
          <UserEventsTable list={events} />
          <p class="mt-3 mb-0">
            <a class="btn btn-primary" href="/events/new"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Create new event</a>
          </p>
          {events.events.some((e) => e.isDefault) && <p class="small text-body-secondary mt-3 mb-0">* New pilot groups use this event by default.</p>}
          <p class="small text-body-secondary mt-3 mb-0">
            Multiple events mode looks too complicated? Switch to the <a href="/settings/events-mode">Single Task mode</a> then.
          </p>
        </section>
      )}
      {others ? (
        <>
          <p class="mt-4 mb-0">
            <a class="btn btn-outline-secondary" href="/"><i class="fa-regular fa-eye-slash fa-fw" aria-hidden="true"></i> Hide {what}</a>
          </p>
          <section class="ft-section mt-4" id="others">
            <h5 class="ft-section-title"><i class="fa-solid fa-earth-europe ft-heading-icon" aria-hidden="true"></i> {admin ? "Others' groups" : "Others' public groups"}</h5>
            <PublicGroupsTable groups={others.list.groups} total={others.list.total} now={now} caption={admin ? "Others' groups" : "Others' public groups"}
                               empty={admin ? 'Nobody else has groups yet.' : 'Nobody else has public groups yet.'} definition={admin} />
          </section>
          <MoreMaps showAll={others.showAll} total={others.list.total} shown={others.list.groups.length} swap={false} noun="groups"
                    recentHref="/?others=1#others" allHref="/?others=1&all=1#others" />
        </>
      ) : (
        <p class="mt-4 mb-0">
          <a class="btn btn-outline-secondary" href="/?others=1#others"><i class="fa-regular fa-eye fa-fw" aria-hidden="true"></i> Show {what}</a>
        </p>
      )}
    </Layout>
  );
}
