import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../src/auth/service.ts';
import type { PublicGroup, UserGroup, UserGroupsList } from '../src/repo/groups.ts';
import { HomePage } from '../src/views/HomePage.tsx';
import type { UserEventsList } from '../src/repo/events.ts';
import { UserHomePage } from '../src/views/UserHomePage.tsx';
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

  it('is a card list on phones with a sticky title and header, like the signed-in table', () => {
    expect(html).toContain('table-responsive-xl ft-table-wrap ft-sticky-head');
    expect(html).toContain('ft-cards');
    expect(html).toContain('ft-section-title');
    for (const label of ['Owner', 'Pilots', 'Views']) expect(html).toContain(`data-label="${label}"`);
    expect(html).not.toContain('d-md-table-cell'); // no hidden columns: the table scrolls instead
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
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('/admin');
  });

  it('shows the Admin link to admins only', () => {
    expect(render({ ...user, roles: ['Admins'] })).toContain('href="/admin"');
  });
});

describe('user home page (my pilot groups)', () => {
  const user: CurrentUser = { id: 'u1', username: 'ann', roles: [] };
  const mine: UserGroup[] = [
    { id: 7, name: '<b>Cup</b> & "Co"', trackers: 3, views: 42, updates: 1234, newestCoordTs: new Date('2026-03-05T11:30:00Z'),
      event: { name: 'Dalby 2024', taskPoints: 5 } },
    { id: 8, name: 'Quiet', trackers: 0, views: 0, updates: 0, newestCoordTs: null, event: { name: 'Empty one', taskPoints: 1 } },
    { id: 9, name: 'Plain', trackers: 2, views: 3, updates: 4, newestCoordTs: null, event: null },
  ];
  const noEvents: UserEventsList = { events: [], show: false };
  const render = (u: CurrentUser, groups = mine, extra: Partial<UserGroupsList> = {}, events: UserEventsList = noEvents) =>
    renderDocument(<UserHomePage user={u} path="/" list={{ groups, showTask: false, simpleEvents: true, ...extra }} events={events} now={now} />);

  it('lists the groups in the same table style as the public maps, with a link to each public map', () => {
    const html = render(user);
    expect(html).toContain('My pilot groups');
    expect(html).toContain('ft-table');
    expect(html).toContain('table-responsive-xl ft-table-wrap ft-sticky-head'); // scrolls sideways below xl, sticky header from xl
    expect(html).toContain('href="/map/7"');
    expect(html).toContain('href="/map/8"');
    expect(html).toContain('Thu 5 Mar 11:30 UTC');
    expect(html).toContain('30 min ago');
  });

  it('offers Edit and Delete next to the public map link of each group', () => {
    const html = render(user);
    for (const id of [7, 8, 9]) {
      expect(html).toContain(`href="/groups/${id}">Edit</a>`);
      expect(html).toContain(`href="/groups/${id}/delete">Delete</a>`);
    }
    expect(html.indexOf('/groups/7">Edit')).toBeLessThan(html.indexOf('/map/7'));
  });

  it('labels the cells that need a label on a card (phones), and only those', () => {
    const html = render({ ...user, roles: ['Admins'] }, mine, { showTask: true, simpleEvents: false });
    expect(html).toContain('ft-cards');
    for (const label of ['Pilots', 'Task', 'Views', 'Updates']) expect(html).toContain(`data-label="${label}"`);
    expect(html).toContain('ft-card-hide'); // a group without a task leaves out the Task line on its card
    expect(html).not.toContain('data-label="Name"');
    expect(html).not.toContain('data-label="Updated"');
  });

  it('escapes group names', () => {
    const html = render(user);
    expect(html).toContain('&lt;b>Cup&lt;/b> &amp; &quot;Co&quot;');
    expect(html).not.toContain('<b>Cup');
  });

  it('shows the Updates counter to admins only', () => {
    expect(render(user)).not.toContain('Updates');
    const admin = render({ ...user, roles: ['Admins'] });
    expect(admin).toContain('Updates');
    expect(admin).toContain('1234');
  });

  it('has no Task column until events are in use', () => {
    const html = render(user);
    expect(html).not.toContain('Task');
    expect(html).not.toContain('Dalby 2024');
  });

  it('names the event in the Task column in the multiple-events mode, and marks an empty task', () => {
    const html = render(user, mine, { showTask: true, simpleEvents: false });
    expect(html).toContain('>Task</th>');
    expect(html).toContain('>Dalby 2024</span>');
    expect(html).not.toContain('yes: ');
    expect(html).toContain('Empty one ^');
    expect(html).toContain('>none</span>');
    expect(html).toContain('^ The task is empty');
  });

  it('says only Yes or No in the single-event mode', () => {
    const html = render(user, mine, { showTask: true, simpleEvents: true });
    expect(html).toContain('>Yes</span>');
    expect(html).toContain('>No</span>');
    expect(html).not.toContain('Dalby 2024');
  });

  it('has a Create new group button, and a button for others\' public groups, below the table', () => {
    const html = render(user);
    expect(html).toContain('href="/groups/new"');
    expect(html).toContain('Create new group');
    expect(html).toContain("Show others' public groups");
    expect(html.indexOf('/groups/new')).toBeGreaterThan(html.indexOf('/map/9'));
    expect(render(user, [])).toContain('Create new group'); // also when there are no groups yet
  });

  it('says so when there are no groups', () => {
    const html = render(user, []);
    expect(html).toContain("You don't have any pilot groups yet.");
    expect(html).not.toContain('ft-table');
  });
});

describe('user home page: my events', () => {
  const user: CurrentUser = { id: 'u1', username: 'ann', roles: [] };
  const events: UserEventsList = {
    show: true,
    events: [
      { id: 1, name: '<i>Dalby</i> 2024', waypoints: 42, isDefault: true },
      { id: 2, name: 'Quiet', waypoints: 0, isDefault: false },
    ],
  };
  const render = (list: UserEventsList) =>
    renderDocument(<UserHomePage user={user} path="/" list={{ groups: [], showTask: false, simpleEvents: false }} events={list} now={now} />);

  it('lists the events in the table style, marking the default one', () => {
    const html = render(events);
    expect(html).toContain('My events');
    expect(html).toContain('>Event</th>');
    expect(html).toContain('data-label="Waypoints"');
    expect(html).toContain('Quiet');
    expect(html).toContain('* &lt;i>Dalby&lt;/i> 2024');
    expect(html.match(/ft-default/g)).toHaveLength(1); // only the default event is highlighted
    expect(html).toContain('* New pilot groups use this event by default.');
    expect(html).not.toContain('<i>Dalby');
  });

  it('offers Edit and Delete for each event', () => {
    const html = render(events);
    for (const id of [1, 2]) {
      expect(html).toContain(`href="/events/${id}">Edit</a>`);
      expect(html).toContain(`href="/events/${id}/delete">Delete</a>`);
    }
  });

  it('says so when there are no events, and has no default note', () => {
    const html = render({ show: true, events: [] });
    expect(html).toContain("You don't have any events yet.");
    expect(html).not.toContain('New pilot groups use');
  });

  it('explains events above the table and offers Create new event, the default note and the way to single mode below it', () => {
    const html = render(events);
    expect(html).toContain('You can set up events here to show tasks on your public maps.');
    expect(html).not.toContain('help'); // no help link
    expect(html.indexOf('show tasks on your public maps')).toBeLessThan(html.indexOf('Dalby'));
    expect(html).toContain('href="/events/new"');
    expect(html.indexOf('/events/new')).toBeGreaterThan(html.indexOf('Quiet'));
    expect(html.indexOf('/events/new')).toBeLessThan(html.indexOf('* New pilot groups use this event by default.'));
    expect(html).toContain('Multiple events mode looks too complicated?');
    expect(html).toContain('href="/settings/events-mode">Single Task mode</a>');
    expect(render({ show: true, events: [] })).toContain('Create new event'); // also with no events yet
  });

  it('is left out in the single-event mode', () => {
    expect(render({ ...events, show: false })).not.toContain('My events');
  });
});
