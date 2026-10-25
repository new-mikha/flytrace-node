// The logged-in user's settings page (events mode, altitude display, default for owner-defined messages).
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import { getSettings, parseSettings, saveSettings } from '../repo/settings.ts';
import { SettingsPage } from '../views/SettingsPage.tsx';
import { sendHtml } from '../views/render.tsx';
import { formFields, setFlash, takeFlash } from './util.ts';

export async function settingsRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  app.get('/settings', guard, async (request, reply) =>
    sendHtml(reply, <SettingsPage user={request.user!} path="/settings" flash={takeFlash(request)} settings={await getSettings(pool, request.user!.id)} />));

  app.post('/settings', guard, async (request, reply) => {
    const user = request.user!;
    const before = await getSettings(pool, user.id);
    const next = parseSettings(formFields(request, 'eventsMode', 'altitude', 'messagesByDefault'));
    if (!next) {
      return sendHtml(reply, <SettingsPage user={user} path="/settings" settings={before} error="Please choose one option in each section." />, 422);
    }
    await saveSettings(pool, user.id, next);
    audit(request, 'settings.changed', 'Settings changed', { before, after: next });
    setFlash(request, 'success', 'Settings saved.');
    return reply.redirect('/settings', 302);
  });
}
