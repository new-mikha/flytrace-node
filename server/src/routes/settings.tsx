// The signed-in user's settings: the list (/settings) and one page per website preference. The account pages are in account.tsx.
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.ts';
import { requireLogin } from '../auth/guards.ts';
import type { Pool } from '../db.ts';
import { getSettings, parseSetting, saveSettings, type UserSettings } from '../repo/settings.ts';
import { AltitudePage, EventsModePage, MessagesPage, SettingsIndexPage } from '../views/SettingsPages.tsx';
import { sendHtml } from '../views/render.tsx';
import { formFields, setFlash, takeFlash } from './util.ts';

export async function settingsRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const guard = { preHandler: requireLogin };

  app.get('/settings', guard, async (request, reply) =>
    sendHtml(reply, <SettingsIndexPage user={request.user!} flash={takeFlash(request)} settings={await getSettings(pool, request.user!.id)} />));

  // Each preference: a page with its choices (GET) and the save (POST, which comes back to the page).
  const preference = <K extends keyof UserSettings>(path: string, key: K, Page: typeof EventsModePage, what: string) => {
    app.get(path, guard, async (request, reply) =>
      sendHtml(reply, <Page user={request.user!} settings={await getSettings(pool, request.user!.id)} flash={takeFlash(request)} />));

    app.post(path, guard, async (request, reply) => {
      const user = request.user!;
      const before = await getSettings(pool, user.id);
      const value = parseSetting(key, formFields(request, key)[key]);
      if (value === null) {
        return sendHtml(reply, <Page user={user} settings={before} error="Please choose one of the options." />, 422);
      }
      await saveSettings(pool, user.id, { ...before, [key]: value });
      audit(request, 'settings.changed', `${what} changed`, { setting: key, before: before[key], after: value });
      setFlash(request, 'success', 'Saved.');
      return reply.redirect(path, 302);
    });
  };
  preference('/settings/events-mode', 'eventsMode', EventsModePage, 'Events mode');
  preference('/settings/altitude', 'altitude', AltitudePage, 'Altitude display');
  preference('/settings/messages', 'messagesByDefault', MessagesPage, 'Default for owner-defined messages');
}
