import type { ComponentChildren } from 'preact';

export interface Flash { kind: 'success' | 'info' | 'danger'; text: string }

const FLASH_ICON = { success: 'fa-circle-check', info: 'fa-circle-info', danger: 'fa-triangle-exclamation' } as const;

export function Alert({ flash }: { flash: Flash | null | undefined }) {
  if (!flash) return null;
  return (
    <div class={`alert alert-${flash.kind}`} role={flash.kind === 'danger' ? 'alert' : 'status'}>
      <i class={`fa-solid ${FLASH_ICON[flash.kind]} me-1`} aria-hidden="true"></i> {flash.text}
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
  return (
    <div class="mb-3">
      <label for={id} class="form-label">{p.label}</label>
      <input id={id} name={p.name} type={type as 'text'} class={`form-control${p.error ? ' is-invalid' : ''}`}
             value={type === 'password' ? undefined : p.value} autocomplete={p.autocomplete}
             required={p.required ?? true} autofocus={p.autofocus} inputmode={p.inputmode} pattern={p.pattern}
             maxlength={p.maxlength} aria-describedby={p.error ? `${id}-err` : p.help ? `${id}-help` : undefined} />
      {p.error && <div id={`${id}-err`} class="invalid-feedback">{p.error}</div>}
      {p.help && !p.error && <div id={`${id}-help`} class="form-text">{p.help}</div>}
    </div>
  );
}

export function Submit({ children, kind = 'primary', icon }: { children: ComponentChildren; kind?: string; icon?: string }) {
  return (
    <button class={`btn btn-${kind}`} type="submit">
      {icon && <><i class={`${icon} fa-fw`} aria-hidden="true"></i>{' '}</>}{children}
    </button>
  );
}

/** Narrow card for the pages of the sign-in family (register, forgot password, ...). */
export function Card({ title, icon, children, wide }: { title: string; icon?: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class={`ft-card mx-auto${wide ? ' ft-card-wide' : ''}`}>
      <h1 class="h3 mb-3">{icon && <><i class={`${icon} text-primary`} aria-hidden="true"></i>{' '}</>}{title}</h1>
      {children}
    </div>
  );
}
