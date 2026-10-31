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

import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import type { UserSettings } from '../repo/settings.ts';
import { Alert, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';
import { currentItem, SETTINGS_GROUPS } from './settingsSections.ts';

interface ShellProps {
  user: CurrentUser;
  path: string;
  flash?: Flash | null;
  /** Page title; leave out on the settings index (/settings). */
  title?: string;
  scripts?: string[];
  /** The user's preferences, to show their current values in the list on phones. */
  settings?: UserSettings;
  children?: ComponentChildren;
}

/**
 * The frame of every settings page (account and website). Wide screens: the list of all settings at the left, the page at
 * the right. Phones: /settings is the list alone, and a page is shown alone with a "Settings" link back to the list.
 */
export function SettingsShell({
  user,
  path,
  flash,
  title,
  scripts,
  settings,
  children,
}: ShellProps) {
  const here = currentItem(path);
  const index = !title;
  return (
    <Layout title={title ?? 'Settings'} user={user} path={path} card="wide" scripts={scripts}>
      {index && (
        <h1 class="h3 mb-3">
          <i class="fa-solid fa-gear text-primary" aria-hidden="true"></i> Settings
        </h1>
      )}
      <Alert flash={flash} />
      <div class="ft-settings">
        <nav class={`ft-settings-nav${index ? '' : ' d-none d-md-block'}`} aria-label="Settings">
          {SETTINGS_GROUPS.map((group) => (
            <section class="ft-settings-group">
              <h2 class="ft-settings-group-title">{group.title}</h2>
              <div class="list-group ft-settings-list">
                {group.items.map((item) => (
                  <a
                    class={`list-group-item list-group-item-action${
                      here?.href === item.href ? ' active' : ''
                    }`}
                    href={item.href}
                    aria-current={here?.href === item.href ? 'page' : undefined}
                  >
                    <i class={`${item.icon} fa-fw ft-settings-icon`} aria-hidden="true"></i>
                    <span class="ft-settings-text">
                      <span class="ft-settings-label">{item.label}</span>
                      <span class="ft-settings-desc d-md-none">{item.description}</span>
                    </span>
                    {item.value && settings && (
                      <span class="ft-settings-value d-md-none">{item.value(settings)}</span>
                    )}
                    <i
                      class="fa-solid fa-chevron-right fa-xs ft-settings-chevron d-md-none"
                      aria-hidden="true"
                    ></i>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div class={`ft-settings-pane${index ? ' d-none d-md-block' : ''}`}>
          {index ? (
            <p class="text-body-secondary">Choose a section on the left.</p>
          ) : (
            <>
              <a class="ft-settings-back d-md-none" href="/settings">
                <i class="fa-solid fa-chevron-left fa-xs" aria-hidden="true"></i> Settings
              </a>
              <h1 class="h3 mb-3">{title}</h1>
              {children}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
