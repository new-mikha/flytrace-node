import type { CurrentUser } from '../auth/service.ts';
import type { UserEventsList } from '../repo/events.ts';
import type { UserGroupsList } from '../repo/groups.ts';
import { Layout } from './Layout.tsx';
import { UserEventsTable } from './UserEventsTable.tsx';
import { UserGroupsTable } from './UserGroupsTable.tsx';

/** The home page of a signed-in user. Their pilot groups, and their events when they use the multiple-events mode. */
export function UserHomePage({ user, path, list, events, now }: { user: CurrentUser; path: string; list: UserGroupsList; events: UserEventsList; now: Date }) {
  return (
    <Layout title="Flytrace" user={user} path={path} card="wide">
      <section class="ft-section">
        <h5 class="ft-section-title"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> My pilot groups</h5>
        <UserGroupsTable list={list} now={now} admin={user.roles.includes('Admins')} />
      </section>
      {!events.show && (
        <p class="small text-body-secondary mt-3 mb-0">
          Events: choose Multiple Events Mode in <a href="/settings">Settings</a> to manage several events.
        </p>
      )}
      {events.show && (
        <section class="ft-section">
          <h5 class="ft-section-title"><i class="fa-solid fa-flag-checkered ft-heading-icon" aria-hidden="true"></i> My events</h5>
          <UserEventsTable list={events} />
        </section>
      )}
    </Layout>
  );
}
