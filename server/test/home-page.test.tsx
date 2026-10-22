import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../src/auth/service.ts';
import type { PublicGroup } from '../src/repo/groups.ts';
import { HomePage } from '../src/views/HomePage.tsx';
import { renderDocument } from '../src/views/render.tsx';

const now = new Date('2026-03-05T12:00:00Z');
const groups: PublicGroup[] = [
  { id: 7, name: '<b>Cup</b> & "Co"', owner: 'ann', trackers: 3, views: 42, newestCoordTs: new Date('2026-03-05T11:30:00Z') },
  { id: 8, name: 'Old one', owner: 'bob', trackers: 2, views: 1, newestCoordTs: new Date('2026-03-01T10:00:00Z') },
  { id: 9, name: 'Never moved', owner: 'cy', trackers: 2, views: 0, newestCoordTs: null },
];

const render = (user: CurrentUser | null, list = groups, extra: { total?: number; showAll?: boolean } = {}) =>
  renderDocument(
    <HomePage user={user} path="/" groups={list} total={extra.total ?? list.length} showAll={extra.showAll ?? false} now={now} />,
  );

describe('home page (anonymous)', () => {
  const html = render(null);

  it('is a complete document with the shared assets', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('/vendor/bootstrap/css/bootstrap.min.css');
    expect(html).toContain('/vendor/fontawesome/css/all.min.css');
    expect(html).toContain('/assets/css/flytrace.css');
  });

  it('has the loading bar that app.js drives', () => {
    expect(html).toContain('id="ft-progress"');
  });

  it('has the login form and the "Register, etc" menu in the bar', () => {
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('action="/login"');
    expect(html).toContain('Register, etc');
    expect(html).not.toContain('Log out');
  });

  it('offers the Register, etc entries twice: as a drop-down on wide screens and inline on phones', () => {
    expect(html.match(/href="\/register"/g)).toHaveLength(2);
    expect(html.match(/href="\/contact"/g)).toHaveLength(2);
    expect(html).toContain('d-none d-lg-flex'); // the drop-down is hidden on phones
    expect(html).toContain('d-lg-none ft-more-inline'); // the inline list is hidden on wide screens
  });

  it('lists every given public group in a responsive table, linking to the map', () => {
    expect(html).toContain('table-responsive');
    expect(html).toContain('href="/map/7"');
    expect(html).toContain('href="/map/8"');
    expect(html).toContain('href="/map/9"');
    expect(html).toContain('ann');
    expect(html).toContain('Thu 5 Mar 11:30 UTC');
  });

  it('highlights the age only for positions less than a day old', () => {
    expect(html).toContain('30 min ago');
    expect(html).not.toContain('4 d 2 hr');
    expect(html.match(/ft-age/g)).toHaveLength(1);
  });

  it('escapes group names', () => {
    // `<` and `&` must never reach the page raw; a bare `>` is harmless in text.
    expect(html).toContain('&lt;b>Cup&lt;/b> &amp; &quot;Co&quot;');
    expect(html).not.toContain('<b>Cup');
  });

  it('serves each screenshot in three sizes', () => {
    for (const n of ['01', '02', '03']) {
      for (const size of ['A', 'B', 'C']) expect(html).toContain(`${n}-size${size}.jpg`);
    }
  });

  it('says so when there are no public maps', () => {
    expect(render(null, [])).toContain('There are no public maps yet.');
  });
});

describe('home page: recent vs all maps', () => {
  it('offers "Show all" with the number of hidden maps when some are hidden', () => {
    const html = render(null, groups, { total: 10 });
    expect(html).toContain('href="/?all=1"');
    expect(html).toContain('Show all 10 maps');
    expect(html).toContain('(7 more)');
    expect(html).not.toContain('Show only the latest week');
  });

  it('marks the links for the in-place swap, inside a swappable container', () => {
    const more = render(null, groups, { total: 10 });
    expect(more).toContain('id="public-maps"');
    expect(more).toContain('href="/?all=1" data-swap-target="public-maps"');
    const all = render(null, groups, { total: groups.length, showAll: true });
    expect(all).toContain('data-swap-target="public-maps"');
  });

  it('offers no button when nothing is hidden', () => {
    const html = render(null, groups, { total: groups.length });
    expect(html).not.toContain('/?all=1');
    expect(html).not.toContain('Show all');
  });

  it('offers a way back to the recent list when everything is shown', () => {
    const html = render(null, groups, { total: groups.length, showAll: true });
    expect(html).toContain('Show only the latest week');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('Show all');
  });

  it('explains an empty recent list when older maps exist', () => {
    const html = render(null, [], { total: 4 });
    expect(html).toContain('No maps have been updated recently.');
    expect(html).toContain('Show all 4 maps');
  });
});

describe('home page (logged in)', () => {
  const user: CurrentUser = { id: 'u1', username: 'ann', roles: [] };

  it('shows the user name and a log-out button instead of the login form', () => {
    const html = render(user);
    expect(html).toContain('Log out');
    expect(html).toContain('My groups');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('/admin');
  });

  it('shows the Admin link to admins only', () => {
    expect(render({ ...user, roles: ['Admins'] })).toContain('href="/admin"');
  });
});
