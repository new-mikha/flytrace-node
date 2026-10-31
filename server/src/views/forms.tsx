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
import { MIN_PASSWORD_LENGTH } from '../auth/accounts.ts';

export interface Flash {
  kind: 'success' | 'info' | 'danger';
  text: string;
}

const FLASH_ICON = {
  success: 'fa-circle-check',
  info: 'fa-circle-info',
  danger: 'fa-triangle-exclamation',
} as const;

export function Alert({ flash }: { flash: Flash | null | undefined; }) {
  if (!flash)
    return null;
  return (
    <div class={`alert alert-${flash.kind}`} role={flash.kind === 'danger' ? 'alert' : 'status'}>
      <i class={`fa-solid ${FLASH_ICON[flash.kind]} me-1`} aria-hidden='true'></i> {flash.text}
    </div>
  );
}

interface FieldProps {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  value?: string;
  error?: string;
  autocomplete?: string;
  help?: ComponentChildren;
  /** Live checklist (see `Hints`) shown under the field whether or not there is an error. */
  hints?: ComponentChildren;
  required?: boolean;
  autofocus?: boolean;
  inputmode?: 'numeric' | 'text';
  pattern?: string;
  maxlength?: number;
}

/** A labelled input with its error message underneath. Passwords are never filled back in. */
export function Field(p: FieldProps) {
  const id = `f-${p.name}`;
  const type = p.type ?? 'text';
  const maxlength = p.maxlength ?? (type === 'password' ? 128 : undefined);
  const input = (
    <input
      id={id}
      name={p.name}
      type={type as 'text'}
      class={`form-control${p.error ? ' is-invalid' : ''}`}
      value={type === 'password' ? undefined : p.value}
      autocomplete={p.autocomplete}
      required={p.required ?? true}
      autofocus={p.autofocus}
      inputmode={p.inputmode}
      pattern={p.pattern}
      maxlength={maxlength}
      aria-describedby={p.error ? `${id}-err` : p.help ? `${id}-help` : undefined}
    />
  );
  return (
    <div class='mb-3'>
      <label for={id} class='form-label'>{p.label}</label>
      {type === 'password'
        ? (
          // The eye button is hidden until public/js/app.js is running (it does nothing without it).
          <div class='input-group has-validation'>
            {input}
            <button
              class='btn btn-outline-secondary ft-pw-toggle'
              type='button'
              hidden
              aria-label='Show password'
              aria-pressed='false'
            >
              <i class='fa-regular fa-eye fa-fw' aria-hidden='true'></i>
            </button>
            {p.error && <div id={`${id}-err`} class='invalid-feedback'>{p.error}</div>}
          </div>
        )
        : (
          <>
            {input}
            {p.error && <div id={`${id}-err`} class='invalid-feedback'>{p.error}</div>}
          </>
        )}
      {p.hints}
      {p.help && !p.error && <div id={`${id}-help`} class='form-text'>{p.help}</div>}
    </div>
  );
}

export function Submit(
  { children, kind = 'primary', icon }: {
    children: ComponentChildren;
    kind?: string;
    icon?: string;
  },
) {
  return (
    <button class={`btn btn-${kind}`} type='submit'>
      {icon && (
        <>
          <i class={`${icon} fa-fw`} aria-hidden='true'></i>
          {' '}
        </>
      )}
      {children}
    </button>
  );
}

/** Narrow card for the pages of the sign-in family (register, forgot password, ...). */
export function Card(
  { title, icon, children, wide }: {
    title: string;
    icon?: string;
    children: ComponentChildren;
    wide?: boolean;
  },
) {
  return (
    <div class={`ft-card mx-auto${wide ? ' ft-card-wide' : ''}`}>
      <h1 class='h3 mb-3'>
        {icon && (
          <>
            <i class={`${icon} text-primary`} aria-hidden='true'></i>
            {' '}
          </>
        )}
        {title}
      </h1>
      {children}
    </div>
  );
}

export interface HintRule {
  /** Name of the rule, matched by public/js/live-hints.js. */
  rule: string;
  text: string;
}

/**
 * Tips under a field, one per rule. All start hidden; public/js/live-hints.js shows a tip only while its rule is
 * broken and the person has left the field. Without JavaScript there are no tips (the server still checks).
 */
export function Hints({ field, rules }: { field: string; rules: HintRule[]; }) {
  return (
    <ul class='ft-hints list-unstyled small mb-0 mt-1' data-hints={field}>
      {rules.map((r) => (
        <li data-rule={r.rule} hidden>
          <i class='fa-solid fa-circle-xmark fa-fw' aria-hidden='true'></i>{' '}
          <span class='ft-hint-text'>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

// Checklists shared by every page that sets a password or an email address (see public/js/live-hints.js).

/** `theirs`: an admin sets the password of somebody else ("their" instead of "your"). */
export function PasswordHints({ theirs }: { theirs?: boolean; } = {}) {
  return (
    <Hints
      field='password'
      rules={[
        {
          rule: 'len',
          text: `The password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
        },
        {
          rule: 'differs',
          text: `The password must not be the same as ${
            theirs ? 'their' : 'your'
          } username or email`,
        },
      ]}
    />
  );
}

export function ConfirmPasswordHints() {
  return (
    <Hints
      field='confirmPassword'
      rules={[{ rule: 'match', text: 'The passwords do not match' }]}
    />
  );
}

/** `different`: the form is for changing an address, so it must differ from the current one (`theirs`: an admin changes it for somebody else). */
export function EmailHints({ different, theirs }: { different?: boolean; theirs?: boolean; }) {
  return (
    <Hints
      field='email'
      rules={[
        { rule: 'format', text: 'Enter a valid email address, like name@example.com' },
        ...(different
          ? [{
            rule: 'different',
            text: `This is ${theirs ? 'their' : 'your'} current email address: enter a new one`,
          }]
          : []),
        { rule: 'free', text: 'This email address is already registered' },
      ]}
    />
  );
}
