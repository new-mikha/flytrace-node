import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.ts';
import { listPublicGroups, listUserGroups } from '../repo/groups.ts';
import { HomePage, PublicMaps } from '../views/HomePage.tsx';
import { UserHomePage } from '../views/UserHomePage.tsx';
import { sendFragment, sendHtml } from '../views/render.tsx';

export async function homeRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  // `?all=1`: the full list. `?fragment=1`: only the list section, which public/js/app.js swaps into the open page
  // so that the address bar keeps its short URL and a refresh shows the short list again.
  app.get<{ Querystring: { all?: string; fragment?: string } }>('/', async (request, reply) => {
    if (request.user) { // signed in: their own groups instead of the introduction and the public maps
      return sendHtml(reply, <UserHomePage user={request.user} path={request.url} list={await listUserGroups(pool, request.user.id)} now={new Date()} />);
    }
    const showAll = request.query.all === '1';
    const { groups, total } = await listPublicGroups(pool, { all: showAll });
    const now = new Date();
    if (request.query.fragment === '1') {
      return sendFragment(reply, <PublicMaps groups={groups} total={total} showAll={showAll} now={now} />);
    }
    return sendHtml(reply,
      <HomePage user={request.user} path={request.url} groups={groups} total={total} showAll={showAll} now={now} />);
  });
}
