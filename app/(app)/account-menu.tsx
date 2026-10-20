'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

/**
 * The button at the right of the header and the panel it opens: a drop-down
 * under the button on wide screens, a drawer from the right on narrow ones
 * (where it also holds the page menu). Escape, the close button, a press
 * outside or choosing a page closes it.
 */
export default function AccountMenu({
  initial,
  name,
  children,
}: {
  initial: string;
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    document.documentElement.setAttribute('data-menu', 'open');
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      document.documentElement.removeAttribute('data-menu');
    };
  }, [open]);

  return (
    <div className="account">
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="menu-name">{name}</span>
        <span className="menu-icon" aria-hidden="true">
          {open ? <X className="icon" /> : <Menu className="icon" />}
        </span>
        <span className="sr-only">のメニュー</span>
      </button>
      <div className="menu-scrim" aria-hidden="true" />
      <div
        ref={panel}
        id={id}
        className="menu-panel"
        data-open={open || undefined}
        inert={!open}
        role="region"
        aria-label="アカウントとページの一覧"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
