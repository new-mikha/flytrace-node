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
