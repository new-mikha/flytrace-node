import type { PublicGroup } from '../repo/groups.ts';
import { formatAge, formatTimestamp } from './format.ts';

function Row({ group, now }: { group: PublicGroup; now: Date }) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class="fw-semibold ft-wrap">
        <a class="ft-group-link" href={`/map/${group.id}`}>{group.name}</a>
        {/* Narrow screens hide the Owner and Pilots columns; show them here instead. */}
        <div class="d-md-none small fw-normal text-body-secondary">by {group.owner}</div>
        <div class="d-sm-none small fw-normal text-body-secondary">{group.trackers} pilots</div>
      </td>
      <td class="ft-wrap d-none d-md-table-cell">{group.owner}</td>
      <td class="text-end d-none d-sm-table-cell"><span class="badge rounded-pill ft-pilots">{group.trackers}</span></td>
      <td class="text-nowrap">
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs)}</div>
            {age?.recent && <div class="ft-age">{age.text}</div>}
          </>
        )}
      </td>
      <td class="text-end d-none d-md-table-cell">{group.views}</td>
    </tr>
  );
}

/** Public maps, newest position first. `table-responsive` scrolls sideways instead of squeezing on narrow screens. */
export function PublicGroupsTable({ groups, total, now }: { groups: PublicGroup[]; total: number; now: Date }) {
  if (groups.length === 0) {
    return <p class="text-muted">{total === 0 ? 'There are no public maps yet.' : 'No maps have been updated recently.'}</p>;
  }
  return (
    <div class="table-responsive ft-table-wrap">
      <table class="table table-striped table-hover align-middle ft-table mb-0">
        <caption class="visually-hidden">Public maps</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col" class="d-none d-md-table-cell">Owner</th>
            <th scope="col" class="text-end d-none d-sm-table-cell">Pilots</th>
            <th scope="col">Updated</th>
            <th scope="col" class="text-end d-none d-md-table-cell">Views</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => <Row key={group.id} group={group} now={now} />)}
        </tbody>
      </table>
    </div>
  );
}
