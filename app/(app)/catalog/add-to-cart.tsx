'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import { MorphButton, settle, type MorphState } from '../../../src/ui/morph';

export function Stepper({
  value,
  onChange,
  label,
  min = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  min?: number;
}) {
  const set = (n: number) => onChange(Math.max(min, Math.min(9999, n)));
  return (
    <span className="stepper">
      <button
        type="button"
        aria-label={`${label}の数量を減らす`}
        onClick={() => set(value - 1)}
      >
        <Minus className="icon sm" aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={9999}
        value={value}
        aria-label={`${label}の数量`}
        onChange={(e) => set(Number(e.target.value) || min)}
      />
      <button
        type="button"
        aria-label={`${label}の数量を増やす`}
        onClick={() => set(value + 1)}
      >
        <Plus className="icon sm" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * A short confirmation at the top of the screen (announced politely). It
 * grows out of a small capsule and draws back into it when it leaves.
 */
export function Toast({
  message,
  ok = true,
}: {
  message: string;
  ok?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState('');
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (message) {
      setShown(message);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => setShown(''), 300);
    return () => clearTimeout(t);
  }, [message]);
  if (!mounted || !shown) return null;
  // On the page body: inside a frosted card, position: fixed would be
  // relative to the card (backdrop-filter makes it the containing block).
  return createPortal(
    <div
      key={shown}
      className="toast"
      role="status"
      data-leaving={leaving || undefined}
    >
      {ok && <Check className="icon" aria-hidden="true" />}
      <span>{shown}</span>
    </div>,
    document.body,
  );
}

function stillMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The product photo, as a small glass drop, arcs from the card into the cart
 * (the dock when it is open, otherwise the cart tab), which then bounces.
 */
function flyToCart(from: Element | null) {
  if (!from || stillMotion()) return;
  const target =
    document.querySelector('.dock .dock-icon') ??
    document.querySelector('.nav a[href="/cart"] .icon');
  if (!target) return;
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const size = 56;
  const x0 = a.left + a.width / 2 - size / 2;
  const y0 = a.top + a.height / 2 - size / 2;
  const dx = b.left + b.width / 2 - size / 2 - x0;
  const dy = b.top + b.height / 2 - size / 2 - y0;
  const peak = Math.min(0, dy) - 90;
  const drop = document.createElement('div');
  drop.className = 'lg-drop';
  drop.setAttribute('aria-hidden', 'true');
  drop.style.left = `${x0}px`;
  drop.style.top = `${y0}px`;
  const lens = document.createElement('div');
  lens.className = 'lg-drop-lens';
  const src = from.querySelector('img')?.currentSrc;
  if (src) lens.style.backgroundImage = `url("${src}")`;
  drop.append(lens);
  document.body.append(drop);
  const duration = 760;
  // x moves evenly while y rises and falls: together they draw an arc.
  drop.animate([{ transform: 'none' }, { transform: `translateX(${dx}px)` }], {
    duration,
    easing: 'cubic-bezier(.4, 0, .6, 1)',
    fill: 'forwards',
  });
  lens
    .animate(
      [
        {
          transform: 'translateY(0) scale(.6)',
          easing: 'cubic-bezier(.2,.9,.3,1)',
        },
        {
          transform: `translateY(${peak}px) scale(1)`,
          offset: 0.38,
          easing: 'cubic-bezier(.6,0,.9,.5)',
        },
        { transform: `translateY(${dy}px) scale(.34)`, opacity: 0.7 },
      ],
      { duration, fill: 'forwards' },
    )
    .finished.then(() => {
      drop.remove();
      const host = target.closest('.dock') ?? target;
      host.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.14, .9)', offset: 0.3 },
          { transform: 'scale(.95, 1.05)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 560, easing: 'ease-out' },
      );
    })
    .catch(() => drop.remove());
}

export default function AddToCart({
  itemId,
  name,
  disabled,
}: {
  itemId: string;
  name: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<MorphState>('idle');
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(true);
  if (disabled)
    return (
      <div className="add">
        <button className="btn" type="button" disabled>
          現在は発注できません
        </button>
      </div>
    );
  return (
    <div className="add" ref={box}>
      <Stepper value={qty} onChange={setQty} label={name} />
      <MorphButton
        className="btn primary"
        type="button"
        state={state}
        onClick={async () => {
          setState('busy');
          const r = await fetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, qty }),
          });
          const body = await r.json().catch(() => ({}));
          setOk(r.ok);
          setMessage(
            r.ok
              ? `カートに入れました：${name} × ${qty}`
              : (body.error ?? '追加できませんでした。'),
          );
          setTimeout(() => setMessage(''), 3500);
          if (!r.ok) {
            setState('idle');
            return;
          }
          setState('done');
          flyToCart(
            box.current?.closest('article')?.querySelector('.pic-wrap') ?? null,
          );
          setQty(1);
          router.refresh();
          await settle(900);
          setState('idle');
        }}
      >
        <ShoppingCart className="icon" aria-hidden="true" />
        カートに入れる
      </MorphButton>
      <Toast message={message} ok={ok} />
    </div>
  );
}
