'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * A button that answers its own press: it sinks into its shadow, and while
 * the request runs it stays half pressed with moving stripes; when it succeeds
 * it turns green and a check stamps down, before the page moves on. The label
 * stays in the DOM (only hidden from view), so the button keeps its
 * accessible name in every state.
 */
export type PressState = 'idle' | 'busy' | 'done';

export function PressButton({
  state,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  state: PressState;
  children: ReactNode;
}) {
  return (
    <button
      {...rest}
      className={`${className} press`}
      data-press={state === 'idle' ? undefined : state}
      aria-busy={state === 'busy' || undefined}
      disabled={disabled || state !== 'idle'}
    >
      <span className="press-label">{children}</span>
      <span className="press-fx" aria-hidden="true">
        <Check className="icon" strokeWidth={3.2} />
      </span>
    </button>
  );
}

export function stillMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Lets the check finish its stamp before the page reloads or changes. */
export function settle(ms = 620) {
  return new Promise<void>((done) => setTimeout(done, stillMotion() ? 0 : ms));
}
