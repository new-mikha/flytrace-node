import type { CurrentUser } from '../auth/service.ts';
import type { UserEventsList } from '../repo/events.ts';
import type { UserGroupsList } from '../repo/groups.ts';
import { Layout } from './Layout.tsx';
import { UserEventsTable } from './UserEventsTable.tsx';
import { UserGroupsTable } from './UserGroupsTable.tsx';

/** The home page of a signed-in user. Their pilot groups, and their events when they use the multiple-events mode. */
export function UserHomePage({ user, path, list, events, now }: { user: CurrentUser; path: string; list: UserGroupsList; events: UserEventsList; now: Date }) {
  return (
    <Layout title="Home" user={user} path={path} card="wide">
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> My pilot groups</h5>
        <UserGroupsTable list={list} now={now} admin={user.roles.includes('Admins')} />
        <p class="mt-3 mb-0">
          <a class="btn btn-primary" href="/groups/new"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Create new group</a>
        </p>
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
      <p class="mt-4 mb-0">
        <a class="btn btn-outline-secondary" href="/?others=1">Show others' public groups</a>
      </p>
    </Layout>
  );
}
