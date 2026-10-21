import type { CurrentUser } from '../auth/service.ts';
import { legacyPage } from '../views/render.tsx';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Page for the template-string routes: `body` is trusted HTML (callers escape user data with `esc`). */
export function page(title: string, body: string, user: CurrentUser | null, path = '/'): string {
  return legacyPage(title, body, user, path);
}
