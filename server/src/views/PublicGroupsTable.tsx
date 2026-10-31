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

import type { PublicGroup } from '../repo/groups.ts';
import { formatAge, formatTimestamp } from './format.ts';

function Row({ group, now, definition }: { group: PublicGroup; now: Date; definition: boolean; }) {
  const age = group.newestCoordTs ? formatAge(group.newestCoordTs, now) : null;
  return (
    <tr>
      <td class='fw-semibold ft-name-cell ft-card-full'>
        <a class='ft-group-link' href={`/map/${group.id}`}>{group.name}</a>
        {group.unlisted && (
          <span class='badge text-bg-secondary ms-1' title='Not public: only admins see it here'>
            Unlisted
          </span>
        )}
      </td>
      <td class='ft-wrap ft-card-stat' data-label='Owner'>{group.owner}</td>
      <td class='text-end ft-card-stat' data-label='Pilots'>
        <span class='badge rounded-pill ft-pilots'>{group.trackers}</span>
      </td>
      <td class='text-nowrap ft-card-full'>
        {group.newestCoordTs && (
          <>
            <div>{formatTimestamp(group.newestCoordTs, now)}</div>
            {age?.recent && <div class='ft-age'>{age.text}</div>}
          </>
        )}
      </td>
      <td class='text-end ft-card-stat' data-label='Views'>{group.views}</td>
      {definition && (
        <td class='text-end text-nowrap ft-card-link ft-actions'>
          <a class='ft-group-link' href={`/groups/${group.id}`}>Definition</a>
        </td>
      )}
    </tr>
  );
}

/**
 * Public maps, newest position first (`definition`: admins get a second link per group, to its definition, in an extra column), in the same table style as the signed-in user's groups: it scrolls sideways below xl,
 * the column header sticks from xl, and below xl (1200 px) every row becomes a card (`ft-cards`, see UserGroupsTable).
 */
export function PublicGroupsTable(
  {
    groups,
    total,
    now,
    caption = 'Public maps',
    empty = 'There are no public maps yet.',
    definition = false,
  }: {
    groups: PublicGroup[];
    total: number;
    now: Date;
    caption?: string;
    empty?: string;
    definition?: boolean;
  },
) {
  if (groups.length === 0)
    return <p class='text-muted'>{total === 0 ? empty : 'No maps have been updated recently.'}</p>;
  return (
    <div class='table-responsive-xl ft-table-wrap ft-sticky-head'>
      <table class='table table-striped table-hover align-middle ft-table ft-cards mb-0'>
        <caption class='visually-hidden'>{caption}</caption>
        <thead>
          <tr>
            <th scope='col'>Group</th>
            <th scope='col'>Owner</th>
            <th scope='col' class='text-end'>Pilots</th>
            <th scope='col'>Updated</th>
            <th scope='col' class='text-end'>Views</th>
            {definition && (
              <th scope='col'>
                <span class='visually-hidden'>Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Row key={group.id} group={group} now={now} definition={definition} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
