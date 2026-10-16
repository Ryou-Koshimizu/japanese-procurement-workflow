'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * A button that answers its own press: it draws in to a circle while the
 * request runs (a ring turns), and pops a check when it succeeds, before the
 * page moves on. The label stays in the DOM (only hidden from view), so the
 * button keeps its accessible name in every state.
 */
export type MorphState = 'idle' | 'busy' | 'done';

export function MorphButton({
  state,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  state: MorphState;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      className={`${className} morph`}
      data-morph={state === 'idle' ? undefined : state}
      aria-busy={state === 'busy' || undefined}
      disabled={disabled || state !== 'idle'}
    >
      <span className="morph-label">{children}</span>
      <span className="morph-fx" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle className="m-track" cx="20" cy="20" r="15" />
          <circle className="m-ring" cx="20" cy="20" r="15" />
          <path className="m-check" d="M13.5 20.5l4.5 4.5 8.5-9" />
        </svg>
      </span>
    </button>
  );
}

function stillMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Lets the check finish its pop before the page reloads or changes. */
export function settle(ms = 620) {
  return new Promise<void>((done) => setTimeout(done, stillMotion() ? 0 : ms));
}
