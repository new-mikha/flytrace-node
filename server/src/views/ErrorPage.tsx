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
import { Layout } from './Layout.tsx';

/** A page for when there is nothing else to show: what happened and the way home. */
export function ErrorPage({
  user,
  path,
  title,
  message,
}: {
  user: CurrentUser | null;
  path: string;
  title: string;
  message: string;
}) {
  return (
    <Layout title={title} user={user} path={path} card>
      <h1 class="h4">{title}</h1>
      <p>{message}</p>
      <a class="btn btn-primary" href="/">
        Go to the home page
      </a>
    </Layout>
  );
}
