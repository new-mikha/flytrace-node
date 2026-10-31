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

import type { UserSettings } from '../repo/settings.ts';

/** One entry of the settings list: a page of the account or of the website preferences. */
export interface SettingsItem {
  href: string;
  label: string;
  /** Font Awesome classes of the icon. */
  icon: string;
  /** One line under the label on phones, where the list is the first screen of the settings. */
  description: string;
  /** The current value shown at the right on phones (preferences only). */
  value?: (s: UserSettings) => string;
}

export const ALTITUDE_LABEL = { none: 'Off', ft: 'Feet', m: 'Kilometers' } as const;

/**
 * Every settings page, in two groups. Wide screens list them in a column at the left of each page;
 * on phones the list is the first screen (/settings) and every entry opens its own page with a way
 * back.
 */
export const SETTINGS_GROUPS: { title: string; items: SettingsItem[] }[] = [
  {
    title: 'Account',
    items: [
      {
        href: '/account',
        label: 'Profile',
        icon: 'fa-regular fa-id-card',
        description: 'Your username, email status and a test email',
      },
      {
        href: '/account/email',
        label: 'Email',
        icon: 'fa-regular fa-envelope',
        description: 'Change the address we write to',
      },
      {
        href: '/account/password',
        label: 'Password',
        icon: 'fa-solid fa-key',
        description: 'Change your password',
      },
      {
        href: '/account/2fa',
        label: 'Two-factor login',
        icon: 'fa-solid fa-shield-halved',
        description: 'Extra security with an authenticator app',
      },
      {
        href: '/account/personal-data',
        label: 'Personal data',
        icon: 'fa-solid fa-database',
        description: 'Download your data or delete the account',
      },
    ],
  },
  {
    title: 'Website',
    items: [
      {
        href: '/settings/events-mode',
        label: 'Events mode',
        icon: 'fa-solid fa-flag-checkered',
        description: 'One Today Task for all groups, or many events',
        value: (s) => (s.eventsMode === 'single' ? 'Single' : 'Multiple'),
      },
      {
        href: '/settings/altitude',
        label: 'Altitude display',
        icon: 'fa-solid fa-mountain',
        description: 'Show the altitude of trackers on your maps',
        value: (s) => ALTITUDE_LABEL[s.altitude],
      },
      {
        href: '/settings/messages',
        label: 'Owner-defined messages',
        icon: 'fa-regular fa-comment-dots',
        description: 'Show or hide them in new groups by default',
        value: (s) => (s.messagesByDefault === 'show' ? 'Show' : 'Hide'),
      },
    ],
  },
];

/**
 * The entry a page belongs to: the longest href that is the page's path or a parent of it
 * (/account/2fa/setup is under /account/2fa).
 */
export function currentItem(path: string): SettingsItem | null {
  let best: SettingsItem | null = null;
  for (const group of SETTINGS_GROUPS)
    for (const item of group.items)
      if (
        (path === item.href || path.startsWith(`${item.href}/`)) &&
        (!best || item.href.length > best.href.length)
      )
        best = item;

  return best;
}
