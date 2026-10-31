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
import {
  type AdminUserRow,
  DEFAULT_SORT,
  FIRST_DIR,
  type SortKey,
  type UserSort,
} from '../repo/adminUsers.ts';
import { formatTimestamp } from './format.ts';
import { Alert, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';

interface Common {
  user: CurrentUser;
  path: string;
  flash?: Flash | null;
}

// ---- the list ----

const isDefaultSort = (sort: UserSort) =>
  sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;

/** The list's address; what is still the default (first page, name A to Z) is left out. */
function listHref(q: string, pageNo: number, sort: UserSort): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (!isDefaultSort(sort)) {
    params.set('sort', sort.key);
    params.set('dir', sort.dir);
  }
  if (pageNo > 1) params.set('page', String(pageNo));
  const query = params.toString();
  return query ? `/admin?${query}` : '/admin';
}

const SORT_LABELS: Record<SortKey, string> = {
  username: 'User name',
  email: 'Email',
  roles: 'Roles',
  groups: 'Groups',
  locked: 'Locked',
  lastLogin: 'Last login',
};

/** A column header that sorts by its column: a click on the current column flips the direction. */
function SortHeader({
  column,
  q,
  sort,
  right,
}: {
  column: SortKey;
  q: string;
  sort: UserSort;
  right?: boolean;
}) {
  const active = sort.key === column;
  const next: UserSort = {
    key: column,
    dir: active ? (sort.dir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[column],
  };
  const icon = !active ? 'fa-sort' : sort.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  return (
    <th
      scope="col"
      class={right ? 'text-end' : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <a class="ft-sort" href={listHref(q, 1, next)}>
        {SORT_LABELS[column]}{' '}
        <i class={`fa-solid ${icon} ft-sort-icon${active ? ' active' : ''}`} aria-hidden="true"></i>
      </a>
    </th>
  );
}

function UserRow({ u }: { u: AdminUserRow }) {
  return (
    <tr>
      <td class="fw-semibold ft-name-cell ft-card-full">{u.username}</td>
      <td class="ft-card-full text-body-secondary">{u.email}</td>
      <td class="ft-card-stat" data-label="Roles">
        {u.roles.join(', ') || '-'}
      </td>
      <td class="text-end ft-card-stat" data-label="Groups">
        {u.groups}
      </td>
      <td class="ft-card-stat" data-label="Locked">
        {u.locked ? (
          <span class="badge text-bg-danger">Yes</span>
        ) : (
          <span class="text-body-secondary">No</span>
        )}
      </td>
      <td class="text-nowrap ft-card-full">
        {u.lastLoginAt ? (
          formatTimestamp(u.lastLoginAt)
        ) : (
          <span class="text-body-secondary">never</span>
        )}
      </td>
      <td class="text-end text-nowrap ft-card-link ft-actions">
        <a class="ft-group-link" href={`/admin/users/${u.id}`}>
          Manage
        </a>
      </td>
    </tr>
  );
}

/** One step of the paginator: a link, or a greyed-out stand-in when there is nowhere to go. Words show from 768 px up, icons always. */
function PageStep({
  href,
  icon,
  label,
  iconAfter,
}: {
  href: string | null;
  icon: string;
  label: string;
  iconAfter?: boolean;
}) {
  const content = (
    <>
      {!iconAfter && <i class={`fa-solid ${icon} fa-xs`} aria-hidden="true"></i>}
      <span class="d-none d-md-inline">{label}</span>
      {iconAfter && <i class={`fa-solid ${icon} fa-xs`} aria-hidden="true"></i>}
    </>
  );
  return href ? (
    <li class="page-item">
      <a class="page-link" href={href} aria-label={label}>
        {content}
      </a>
    </li>
  ) : (
    <li class="page-item disabled">
      <span class="page-link" aria-disabled="true">
        {content}
      </span>
    </li>
  );
}

/** "N users" and << First | < Prev | Page [n] of N | Next > | Last >> in one bar that stays under the search box. */
function PagerBar({
  q,
  sort,
  total,
  pageNo,
  pages,
}: {
  q: string;
  sort: UserSort;
  total: number;
  pageNo: number;
  pages: number;
}) {
  const to = (n: number) => listHref(q, n, sort);
  return (
    <div class="ft-pager-bar">
      <span class="text-body-secondary text-nowrap">
        {total} {total === 1 ? 'user' : 'users'}
      </span>
      {pages > 1 && (
        <nav class="d-flex align-items-center gap-2" aria-label="Pages">
          <ul class="pagination pagination-sm mb-0">
            <PageStep href={pageNo > 1 ? to(1) : null} icon="fa-angles-left" label="First" />
            <PageStep href={pageNo > 1 ? to(pageNo - 1) : null} icon="fa-angle-left" label="Prev" />
          </ul>
          <form
            method="get"
            action="/admin"
            class="d-flex align-items-center gap-1 text-body-secondary text-nowrap"
          >
            {q && <input type="hidden" name="q" value={q} />}
            {!isDefaultSort(sort) && (
              <>
                <input type="hidden" name="sort" value={sort.key} />
                <input type="hidden" name="dir" value={sort.dir} />
              </>
            )}
            <label for="page-no" class="d-none d-sm-inline">
              Page
            </label>
            <input
              id="page-no"
              class="form-control form-control-sm ft-page-input"
              type="number"
              name="page"
              min={1}
              max={pages}
              value={pageNo}
              inputmode="numeric"
              aria-label="Page number"
            />
            <span>of {pages}</span>
          </form>
          <ul class="pagination pagination-sm mb-0">
            <PageStep
              href={pageNo < pages ? to(pageNo + 1) : null}
              icon="fa-angle-right"
              label="Next"
              iconAfter
            />
            <PageStep
              href={pageNo < pages ? to(pages) : null}
              icon="fa-angles-right"
              label="Last"
              iconAfter
            />
          </ul>
        </nav>
      )}
    </div>
  );
}

export function AdminUsersPage({
  user,
  path,
  flash,
  q,
  users,
  total,
  pageNo,
  pageSize,
  sort,
}: Common & {
  q: string;
  users: AdminUserRow[];
  total: number;
  pageNo: number;
  pageSize: number;
  sort: UserSort;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Layout title="Users" user={user} path={path} card="wide">
      <section class="ft-section ft-has-search">
        <h5 class="ft-section-title">
          <i class="fa-solid fa-users ft-heading-icon" aria-hidden="true"></i> Users
        </h5>
        <Alert flash={flash} />
        <form method="get" action="/admin" class="ft-search" role="search">
          {!isDefaultSort(sort) && (
            <>
              <input type="hidden" name="sort" value={sort.key} />
              <input type="hidden" name="dir" value={sort.dir} />
            </>
          )}
          <input
            class="form-control"
            type="search"
            name="q"
            value={q}
            maxlength={100}
            placeholder="Part of a user name or email"
            aria-label="Search users"
          />
          <button class="btn btn-primary" type="submit">
            Search
          </button>
          {q && (
            <a class="btn btn-outline-secondary" href="/admin">
              Clear
            </a>
          )}
        </form>
        <PagerBar q={q} sort={sort} total={total} pageNo={pageNo} pages={pages} />
        {/* The column headers are hidden while the table is cards (below 1200 px), so there the order is chosen here, in a bar that sticks like the others. */}
        <form method="get" action="/admin" class="ft-sort-bar d-xl-none">
          {q && <input type="hidden" name="q" value={q} />}
          <label class="text-body-secondary" for="sort-by">
            Sort by
          </label>
          <select id="sort-by" name="sort" class="form-select form-select-sm w-auto">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option value={k} selected={k === sort.key}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <select name="dir" class="form-select form-select-sm w-auto" aria-label="Direction">
            <option value="asc" selected={sort.dir === 'asc'}>
              ascending
            </option>
            <option value="desc" selected={sort.dir === 'desc'}>
              descending
            </option>
          </select>
          <button class="btn btn-outline-secondary btn-sm" type="submit">
            Sort
          </button>
        </form>
        {users.length > 0 && (
          <div class="table-responsive-xl ft-table-wrap ft-sticky-head">
            <table class="table table-striped table-hover align-middle ft-table ft-cards mb-0">
              <caption class="visually-hidden">Users</caption>
              <thead>
                <tr>
                  <SortHeader column="username" q={q} sort={sort} />
                  <SortHeader column="email" q={q} sort={sort} />
                  <SortHeader column="roles" q={q} sort={sort} />
                  <SortHeader column="groups" q={q} sort={sort} right />
                  <SortHeader column="locked" q={q} sort={sort} />
                  <SortHeader column="lastLogin" q={q} sort={sort} />
                  <th scope="col">
                    <span class="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} u={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
