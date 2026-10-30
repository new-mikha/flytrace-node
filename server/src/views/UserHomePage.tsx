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
import type { TodayTask, UserEventsList } from '../repo/events.ts';
import type { PublicGroupsList, UserGroupsList } from '../repo/groups.ts';
import { ConfirmDialog } from './confirmDelete.tsx';
import { MoreMaps } from './HomePage.tsx';
import { Alert, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';
import { PublicGroupsTable } from './PublicGroupsTable.tsx';
import { UserEventsTable } from './UserEventsTable.tsx';
import { UserGroupsTable } from './UserGroupsTable.tsx';

/** "Switch to the ... mode then." at the bottom of the two task panels: a POST, so the link is a button that looks like one. */
function SwitchMode({ to, lead, label }: { to: 'single' | 'multiple'; lead: string; label: string }) {
  return (
    <form class="small text-body-secondary mt-3 mb-0" method="post" action="/events-mode">
      <input type="hidden" name="to" value={to} />
      {lead}<br />Switch to the <button class="btn btn-link btn-sm p-0 align-baseline" type="submit">{label}</button> then.
    </form>
  );
}

/** The single-event mode: one "Today Task" (the default event). Where its waypoints and task are edited is not built yet. */
function TodayTaskPanel({ today, groups }: { today: TodayTask; groups: number }) {
  return (
    <section class="ft-section">
      <h5 class="ft-section-title"><i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> Today Task <span class="ft-section-note">optional</span></h5>
      <p class="text-body-secondary">Here you can manage competition waypoints, and set up a task then to display on your public maps.</p>
      {groups === 0 ? <p>But first create a pilot group above.</p> : (
        <>
          {today.waypoints === 0 ? (
            <p>Competition waypoints not loaded yet.<br /><a href="/events/default/waypoints">Load waypoints now (optional)...</a></p>
          ) : (
            <>
              <p><strong>{today.waypoints}</strong> competition waypoint{today.waypoints === 1 ? '' : 's'} loaded.<br /><a href="/events/default/waypoints">View/edit all waypoints...</a></p>
              {today.taskWaypoints === 0 ? (
                <p>There is no task at the moment.<br /><a href="/events/default">Set up a task...</a></p>
              ) : (
                <p>
                  Task set with <strong>{today.taskWaypoints}</strong> waypoint{today.taskWaypoints === 1 ? '' : 's'}
                  {today.taskWaypoints === 1 && <>, so it is an empty task. Add more waypoints to the task to show it on your maps</>}.<br />
                  <a href="/events/default">View/edit Today Task</a>
                </p>
              )}
            </>
          )}
        </>
      )}
      <SwitchMode to="multiple" lead="Having more than one competition at a time?" label="Multiple Events mode" />
    </section>
  );
}

/** The home page of a signed-in user. Their pilot groups, and their events when they use the multiple-events mode. */
export function UserHomePage({ user, path, list, events, today, others, now, flash }: {
  user: CurrentUser; path: string; list: UserGroupsList; events: UserEventsList; today: TodayTask; now: Date; flash?: Flash | null;
  /** Other people's groups, when "Show others' groups" is on (`/?others=1`). */
  others?: { list: PublicGroupsList; showAll: boolean } | null;
}) {
  const admin = user.roles.includes('Admins');
  const what = admin ? "others' groups" : "others' public groups"; // admins also get the unlisted ones
  return (
    <Layout title="Home" user={user} path={path} card="wide" scripts={list.groups.length > 0 || events.events.length > 0 ? ['confirm-dialog.js'] : undefined}>
      <Alert flash={flash} />
      {(list.groups.length > 0 || events.events.length > 0) && <ConfirmDialog />}
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> My pilot groups</h5>
        <UserGroupsTable list={list} now={now} admin={user.roles.includes('Admins')} />
        <form class="mt-3 mb-0" method="post" action="/groups">
          <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Create new group</button>
        </form>
      </section>
      {!events.show && <TodayTaskPanel today={today} groups={list.groups.length} />}
      {events.show && (
        <section class="ft-section">
          <h5 class="ft-section-title"><i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> My events</h5>
          <p class="text-body-secondary">You can set up events here to show tasks on your public maps.</p>
          <UserEventsTable list={events} />
          <form class="mt-3 mb-0" method="post" action="/events">
            <button class="btn btn-primary" type="submit"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Create new event</button>
          </form>
          {events.events.some((e) => e.isDefault) && <p class="small text-body-secondary mt-3 mb-0">* New pilot groups use this event by default.</p>}
          <SwitchMode to="single" lead="Multiple events mode looks too complicated?" label="Single Task mode" />
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
