import type { ComponentChildren } from 'preact';
import type { CurrentUser } from '../auth/service.ts';
import type { UserSettings } from '../repo/settings.ts';
import { Alert, Submit, type Flash } from './forms.tsx';
import { Layout } from './Layout.tsx';

function Choice({ name, value, current, label, children }: { name: string; value: string; current: string; label: string; children?: ComponentChildren }) {
  const id = `s-${name}-${value}`;
  return (
    <div class="form-check mb-2">
      <input class="form-check-input" type="radio" name={name} id={id} value={value} checked={current === value} />
      <label class="form-check-label" for={id}>{label}</label>
      {children && <div class="form-text mt-0">{children}</div>}
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro: ComponentChildren; children: ComponentChildren }) {
  return (
    <fieldset class="ft-settings-section mb-4">
      <legend class="h6 ft-settings-title">{title}</legend>
      <p class="text-body-secondary">{intro}</p>
      {children}
    </fieldset>
  );
}

/** The signed-in user's settings: how their groups, events and maps behave. One form, one Save button. */
export function SettingsPage({ user, path, flash, settings, error }: { user: CurrentUser; path: string; flash?: Flash | null; settings: UserSettings; error?: string }) {
  return (
    <Layout title="Settings" user={user} path={path} card="medium">
      <h1 class="h3 mb-3"><i class="fa-solid fa-gear text-primary" aria-hidden="true"></i> Settings</h1>
      <Alert flash={flash} />
      {error && <Alert flash={{ kind: 'danger', text: error }} />}
      <form method="post" action="/settings" class="ft-form">
        <Section title="Events mode" intro="An event is e.g. a competition or fly-in. A pilot group can have an event assigned; its map then shows the Today Task of the event.">
          <Choice name="eventsMode" value="single" current={settings.eventsMode} label="Single Task Mode">
            You have only one default event, so one Today Task for all your groups. Simple mode is OK for most cases.
          </Choice>
          <Choice name="eventsMode" value="multiple" current={settings.eventsMode} label="Multiple Events Mode">
            You can have many events, e.g. for a joint competition with more than one task running together. Your events are listed on the home page.
          </Choice>
        </Section>

        <Section title="Altitude display" intro="Some tracker models (e.g. SPOT Gen3) send their altitude. When it is available, it can be shown on your maps.">
          <Choice name="altitude" value="none" current={settings.altitude} label="Do not show altitude on your maps" />
          <Choice name="altitude" value="ft" current={settings.altitude} label="Show altitude in feet (ft)" />
          <Choice name="altitude" value="m" current={settings.altitude} label="Show altitude in meters (m)" />
        </Section>

        <Section title="Owner-defined messages" intro="Whether a newly created group shows or hides the messages that you define for it. Each group can still be changed later.">
          <Choice name="messagesByDefault" value="show" current={settings.messagesByDefault} label="Show owner-defined messages by default" />
          <Choice name="messagesByDefault" value="hide" current={settings.messagesByDefault} label="Hide owner-defined messages by default" />
        </Section>

        <Submit icon="fa-solid fa-check">Save settings</Submit>
      </form>
    </Layout>
  );
}
