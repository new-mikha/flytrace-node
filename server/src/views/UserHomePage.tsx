import type { CurrentUser } from '../auth/service.ts';
import type { UserGroup } from '../repo/groups.ts';
import { Layout } from './Layout.tsx';
import { UserGroupsTable } from './UserGroupsTable.tsx';

/** The home page of a signed-in user. For now only their pilot groups; events and tasks come later. */
export function UserHomePage({ user, path, groups, now }: { user: CurrentUser; path: string; groups: UserGroup[]; now: Date }) {
  return (
    <Layout title="Flytrace" user={user} path={path} card="wide">
      <h5 class="mb-3"><i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> My pilot groups</h5>
      <UserGroupsTable groups={groups} now={now} admin={user.roles.includes('Admins')} />
    </Layout>
  );
}
