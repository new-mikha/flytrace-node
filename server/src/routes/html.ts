import type { CurrentUser } from '../auth/service.ts';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Deliberately bare page shell for the milestone-1 skeleton. */
export function page(title: string, body: string, user: CurrentUser | null): string {
  const who = user
    ? `Logged in as <b>${esc(user.username)}</b> (${esc(user.roles.join(', ') || 'no roles')})
       <form method="post" action="/logout" style="display:inline"><button>Log out</button></form>`
    : `Not logged in. <a href="/login">Log in</a>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - FlyTrace</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:60rem}nav a{margin-right:1rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}.err{color:#b00}</style></head>
<body>
<nav><a href="/">Home</a><a href="/groups">My groups</a><a href="/admin">Admin</a></nav>
<p>${who}</p>
<h1>${esc(title)}</h1>
${body}
</body></html>`;
}
