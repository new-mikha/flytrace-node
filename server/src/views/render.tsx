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

import type { FastifyReply } from 'fastify';
import type { VNode } from 'preact';
import { render } from 'preact-render-to-string';
import type { CurrentUser } from '../auth/service.ts';
import { Layout } from './Layout.tsx';

export function renderDocument(page: VNode): string {
  return `<!doctype html>${render(page)}`;
}

/** An HTML fragment (no document around it), for parts of a page that the browser swaps in. */
export function sendFragment(reply: FastifyReply, fragment: VNode): FastifyReply {
  return reply.type('text/html; charset=utf-8').send(render(fragment));
}

export function sendHtml(reply: FastifyReply, page: VNode, status = 200): FastifyReply {
  return reply.code(status).type('text/html; charset=utf-8').send(renderDocument(page));
}

/**
 * Wraps a pre-built HTML body (the older template-string pages) in the shared layout.
 * `bodyHtml` must already be escaped by the caller.
 */
export function legacyPage(title: string, bodyHtml: string, user: CurrentUser | null, path: string): string {
  return renderDocument(
    <Layout title={title} user={user} path={path}>
      <h1 class="h3 mb-3">{title}</h1>
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </Layout>,
  );
}
