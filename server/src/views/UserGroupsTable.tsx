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

import type { UserGroup, UserGroupsList } from '../repo/groups.ts';
import { confirmAttrs, confirmDeleteGroup } from './confirmDelete.tsx';
import { formatAge, formatTimestamp } from './format.ts';

/** A task of fewer than two points is not drawn on the map. */
const isEmptyTask = (group: UserGroup) => group.event !== null && group.event.taskPoints < 2;

function TaskCell({ group, simple }: { group: UserGroup; simple: boolean }) {
  if (!group.event) return <span class="text-body-secondary">{simple ? 'No' : 'none'}</span>;
  return (
    <span class={isEmptyTask(group) ? 'text-body-secondary' : undefined}>
      {simple ? 'Yes' : group.event.name}
      {isEmptyTask(group) && ' ^'}
    </span>
  );
}

function Row({
  group,
  now,
  admin,
  task,
}: {
  group: UserGroup;
  now: Date;
  admin: boolean;
  task: { simple: boolean } | null;
}) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class="fw-semibold ft-name-cell ft-card-full">{group.name}</td>
      <td class="text-end ft-card-stat" data-label="Pilots">
        <span class="badge rounded-pill ft-pilots">{group.trackers}</span>
      </td>
      <td class="text-nowrap ft-card-full">
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs, now)}</div>
            {age?.recent && <div class="ft-age">{age.text}</div>}
          </>
        )}
      </td>
      {task && (
        <td
          class={`ft-task-cell ft-card-task${group.event ? '' : ' ft-card-hide'}`}
          data-label="Task"
        >
          <TaskCell group={group} simple={task.simple} />
        </td>
      )}
      <td class="text-end ft-card-stat" data-label="Views">
        {group.views}
      </td>
      {admin && (
        <td class="text-end ft-card-stat" data-label="Updates">
          {group.updates}
        </td>
      )}
      <td class="text-end text-nowrap ft-card-link ft-actions">
        <a class="ft-group-link" href={`/groups/${group.id}`}>
          Edit
        </a>
        <a class="ft-danger-link" {...confirmAttrs(confirmDeleteGroup(group, group.trackers))}>
          Delete
        </a>
        <a class="ft-group-link" href={`/map/${group.id}`} target="_blank" rel="noopener">
          Public map <i class="fa-solid fa-arrow-up-right-from-square fa-xs" aria-hidden="true"></i>
        </a>
      </td>
    </tr>
  );
}

/**
 * The signed-in user's own groups, in the same table style as the public maps on the anonymous home
 * page. Below xl (`ft-cards`, under 1200 px) every row becomes a card, with `data-label` as the
 * label of the cells that need one; the `table-responsive-xl` box only keeps a table that is still
 * too wide scrollable.
 */
export function UserGroupsTable({
  list: { groups, showTask, simpleEvents },
  now,
  admin,
}: {
  list: UserGroupsList;
  now: Date;
  admin: boolean;
}) {
  if (groups.length === 0) return <p class="text-muted">You don't have any pilot groups yet.</p>;
  const task = showTask ? { simple: simpleEvents } : null;
  return (
    <>
      <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
        <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
          <caption class="visually-hidden">My pilot groups</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" class="text-end">
                Pilots
              </th>
              <th scope="col">Updated</th>
              {task && <th scope="col">Task</th>}
              <th scope="col" class="text-end">
                Views
              </th>
              {admin && (
                <th scope="col" class="text-end">
                  Updates
                </th>
              )}
              <th scope="col">
                <span class="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Row key={group.id} group={group} now={now} admin={admin} task={task} />
            ))}
          </tbody>
        </table>
      </div>
      {task && groups.some(isEmptyTask) && (
        <p class="small text-body-secondary mt-2 mb-0">
          ^ The task is empty, so no task is shown on the group's map.
        </p>
      )}
    </>
  );
}
