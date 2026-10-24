import type { PublicGroup } from '../repo/groups.ts';
import { formatAge, formatTimestamp } from './format.ts';

function Row({ group, now }: { group: PublicGroup; now: Date }) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class="fw-semibold ft-name-cell ft-card-full">
        <a class="ft-group-link" href={`/map/${group.id}`}>{group.name}</a>
      </td>
      <td class="ft-wrap ft-card-stat" data-label="Owner">{group.owner}</td>
      <td class="text-end ft-card-stat" data-label="Pilots"><span class="badge rounded-pill ft-pilots">{group.trackers}</span></td>
      <td class="text-nowrap ft-card-full">
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs)}</div>
            {age?.recent && <div class="ft-age">{age.text}</div>}
          </>
        )}
      </td>
      <td class="text-end ft-card-stat" data-label="Views">{group.views}</td>
    </tr>
  );
}

/**
 * Public maps, newest position first, in the same table style as the signed-in user's groups: it scrolls sideways below xl,
 * the column header sticks from xl, and below xl (1200 px) every row becomes a card (`ft-cards`, see UserGroupsTable).
 */
export function PublicGroupsTable({ groups, total, now }: { groups: PublicGroup[]; total: number; now: Date }) {
  if (groups.length === 0) {
    return <p class="text-muted">{total === 0 ? 'There are no public maps yet.' : 'No maps have been updated recently.'}</p>;
  }
  return (
    <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
      <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
        <caption class="visually-hidden">Public maps</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Owner</th>
            <th scope="col" class="text-end">Pilots</th>
            <th scope="col">Updated</th>
            <th scope="col" class="text-end">Views</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => <Row key={group.id} group={group} now={now} />)}
        </tbody>
      </table>
    </div>
  );
}
