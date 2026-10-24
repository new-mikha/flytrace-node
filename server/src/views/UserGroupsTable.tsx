import type { UserGroup, UserGroupsList } from '../repo/groups.ts';
import { formatAge, formatTimestamp } from './format.ts';

/** A task of fewer than two points is not drawn on the map. */
const isEmptyTask = (group: UserGroup) => group.event !== null && group.event.taskPoints < 2;

function TaskCell({ group, simple }: { group: UserGroup; simple: boolean }) {
  if (!group.event) return <span class="text-body-secondary">{simple ? 'No' : 'none'}</span>;
  return (
    <span class={isEmptyTask(group) ? 'text-body-secondary' : undefined}>
      {simple ? 'Yes' : `yes: ${group.event.name}`}{isEmptyTask(group) && ' ^'}
    </span>
  );
}

function Row({ group, now, admin, task }: { group: UserGroup; now: Date; admin: boolean; task: { simple: boolean } | null }) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class="fw-semibold ft-name-cell">{group.name}</td>
      <td class="text-end"><span class="badge rounded-pill ft-pilots">{group.trackers}</span></td>
      <td class="text-nowrap">
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs)}</div>
            {age?.recent && <div class="ft-age">{age.text}</div>}
          </>
        )}
      </td>
      {task && <td class="ft-task-cell"><TaskCell group={group} simple={task.simple} /></td>}
      <td class="text-end">{group.views}</td>
      {admin && <td class="text-end">{group.updates}</td>}
      <td class="text-end text-nowrap">
        <a class="ft-group-link" href={`/map/${group.id}`} target="_blank" rel="noopener">
          Public map <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
        </a>
      </td>
    </tr>
  );
}

/**
 * The signed-in user's own groups, in the same table style as the public maps on the anonymous home page. All columns
 * stay on every screen: a narrow screen scrolls the table sideways (`table-responsive`) instead of squeezing it.
 */
export function UserGroupsTable({ list: { groups, showTask, simpleEvents }, now, admin }: { list: UserGroupsList; now: Date; admin: boolean }) {
  if (groups.length === 0) return <p class="text-muted">You don't have any pilot groups yet.</p>;
  const task = showTask ? { simple: simpleEvents } : null;
  return (
    <>
    <div class="table-responsive-xl ft-table-wrap ft-bleed ft-sticky-head">
      <table class="table table-striped table-hover align-middle ft-table mb-0">
        <caption class="visually-hidden">My pilot groups</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col" class="text-end">Pilots</th>
            <th scope="col">Updated</th>
            {task && <th scope="col">Task</th>}
            <th scope="col" class="text-end">Views</th>
            {admin && <th scope="col" class="text-end">Updates</th>}
            <th scope="col"><span class="visually-hidden">Links</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => <Row key={group.id} group={group} now={now} admin={admin} task={task} />)}
        </tbody>
      </table>
    </div>
    {task && groups.some(isEmptyTask) && (
      <p class="small text-body-secondary mt-2 mb-0">^ The task is empty, so no task is shown on the group's map.</p>
    )}
    </>
  );
}
