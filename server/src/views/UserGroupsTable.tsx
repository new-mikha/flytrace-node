import type { UserGroup } from '../repo/groups.ts';
import { formatAge, formatTimestamp } from './format.ts';

function Row({ group, now, admin }: { group: UserGroup; now: Date; admin: boolean }) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class="fw-semibold ft-wrap">
        {group.name}
        {/* Narrow screens hide the Pilots and Views columns; show them here instead. */}
        <div class="d-sm-none small fw-normal text-body-secondary">{group.trackers} pilots, {group.views} views</div>
      </td>
      <td class="text-end d-none d-sm-table-cell"><span class="badge rounded-pill ft-pilots">{group.trackers}</span></td>
      <td class="text-nowrap">
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs)}</div>
            {age?.recent && <div class="ft-age">{age.text}</div>}
          </>
        )}
      </td>
      <td class="text-end d-none d-sm-table-cell">{group.views}</td>
      {admin && <td class="text-end d-none d-md-table-cell">{group.updates}</td>}
      <td class="text-end text-nowrap">
        <a class="ft-group-link" href={`/map/${group.id}`} target="_blank" rel="noopener">
          Public map <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
        </a>
      </td>
    </tr>
  );
}

/** The signed-in user's own groups, in the same table style as the public maps on the anonymous home page. */
export function UserGroupsTable({ groups, now, admin }: { groups: UserGroup[]; now: Date; admin: boolean }) {
  if (groups.length === 0) return <p class="text-muted">You don't have any pilot groups yet.</p>;
  return (
    <div class="table-responsive ft-table-wrap">
      <table class="table table-striped table-hover align-middle ft-table mb-0">
        <caption class="visually-hidden">My pilot groups</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" class="text-end d-none d-sm-table-cell">Pilots</th>
            <th scope="col">Updated</th>
            <th scope="col" class="text-end d-none d-sm-table-cell">Views</th>
            {admin && <th scope="col" class="text-end d-none d-md-table-cell">Updates</th>}
            <th scope="col"><span class="visually-hidden">Links</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => <Row key={group.id} group={group} now={now} admin={admin} />)}
        </tbody>
      </table>
    </div>
  );
}
