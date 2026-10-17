'use client';
// One question of the intake form, as A社 sees it (also the admin's preview).
import type { RequestField } from '../core/intake';

export function IntakeField({
  field,
  value,
  onChange,
  error,
  idPrefix = 'f',
}: {
  field: Pick<
    RequestField,
    'key' | 'label' | 'kind' | 'required' | 'options' | 'help'
  >;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  const helpId = field.help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    required: field.required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <div className={`field${field.kind === 'textarea' ? ' wide' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required ? (
          <span className="req-mark">（必須）</span>
        ) : (
          <span className="help">（任意）</span>
        )}
      </label>
      {field.kind === 'textarea' ? (
        <textarea {...common} maxLength={2000} />
      ) : field.kind === 'choice' ? (
        <select {...common}>
          <option value="">選んでください</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={
            field.kind === 'date'
              ? 'date'
              : field.kind === 'url'
                ? 'url'
                : 'text'
          }
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          maxLength={field.kind === 'text' ? 200 : 2000}
        />
      )}
      {field.help && (
        <span className="help" id={helpId}>
          {field.help}
        </span>
      )}
      {error && (
        <span className="field-error" id={errId}>
          {error}
        </span>
      )}
    </div>
  );
}
