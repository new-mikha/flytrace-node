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
import { Alert, type Flash, Submit } from './forms.tsx';
import { SettingsShell } from './SettingsShell.tsx';

interface Common {
  user: CurrentUser;
  settings: UserSettings;
  flash?: Flash | null;
  error?: string;
}

/**
 * The first screen of the settings on phones (the list); wide screens show the same list at the
 * left of every page.
 */
export function SettingsIndexPage({ user, settings, flash }: Omit<Common, 'error'>) {
  return <SettingsShell user={user} path="/settings" flash={flash} settings={settings} />;
}

function Choice({
  name,
  value,
  current,
  label,
  children,
}: {
  name: string;
  value: string;
  current: string;
  label: string;
  children?: ComponentChildren;
}) {
  const id = `s-${name}-${value}`;
  return (
    <div class="form-check mb-2">
      <input
        class="form-check-input"
        type="radio"
        name={name}
        id={id}
        value={value}
        checked={current === value}
      />
      <label class="form-check-label" for={id}>
        {label}
      </label>
      {children && <div class="form-text mt-0">{children}</div>}
    </div>
  );
}

/** One preference on its own page: an introduction, the choices and a Save button. */
function PreferencePage({
  title,
  path,
  intro,
  children,
  user,
  settings,
  flash,
  error,
}: Common & {
  title: string;
  path: string;
  intro: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <SettingsShell title={title} user={user} path={path} flash={flash} settings={settings}>
      <p class="text-body-secondary">{intro}</p>
      {error && <Alert flash={{ kind: 'danger', text: error }} />}
      <form method="post" action={path} class="ft-form" data-guard="changed">
        {children}
        <div class="mt-3">
          <Submit>Save</Submit>
        </div>
      </form>
    </SettingsShell>
  );
}

export function EventsModePage(c: Common) {
  return (
    <PreferencePage
      title="Events mode"
      path="/settings/events-mode"
      {...c}
      intro="An event is e.g. a competition or fly-in. A pilot group can have an event assigned; its map then shows the Today Task of the event."
    >
      <Choice
        name="eventsMode"
        value="single"
        current={c.settings.eventsMode}
        label="Single Task Mode"
      >
        You have only one default event, so one Today Task for all your groups. Simple mode is OK
        for most cases.
      </Choice>
      <Choice
        name="eventsMode"
        value="multiple"
        current={c.settings.eventsMode}
        label="Multiple Events Mode"
      >
        You can have many events, e.g. for a joint competition with more than one task running
        together. Your events are listed on the home page.
      </Choice>
    </PreferencePage>
  );
}

export function AltitudePage(c: Common) {
  return (
    <PreferencePage
      title="Altitude display"
      path="/settings/altitude"
      {...c}
      intro="Some tracker models (e.g. SPOT Gen3) send their altitude. When it is available, it can be shown on your maps."
    >
      <Choice
        name="altitude"
        value="none"
        current={c.settings.altitude}
        label="Do not show altitude on your maps"
      />
      <Choice
        name="altitude"
        value="ft"
        current={c.settings.altitude}
        label="Show altitude in feet"
      >
        When available, altitude will be shown as FT for trackers that send it.
      </Choice>
      <Choice
        name="altitude"
        value="m"
        current={c.settings.altitude}
        label="Show altitude in kilometers"
      >
        When available, altitude will be shown as KM for trackers that send it.
      </Choice>
    </PreferencePage>
  );
}

export function MessagesPage(c: Common) {
  return (
    <PreferencePage
      title="Owner-defined messages"
      path="/settings/messages"
      {...c}
      intro="Whether a newly created group shows or hides the messages that you define for it. Each group can still be changed later."
    >
      <Choice
        name="messagesByDefault"
        value="show"
        current={c.settings.messagesByDefault}
        label="Show owner-defined messages by default"
      >
        A newly created group will have its "Owner-defined messages" option set to "Show".
      </Choice>
      <Choice
        name="messagesByDefault"
        value="hide"
        current={c.settings.messagesByDefault}
        label="Hide owner-defined messages by default"
      >
        A newly created group will have its "Owner-defined messages" option set to "Hide".
      </Choice>
    </PreferencePage>
  );
}
