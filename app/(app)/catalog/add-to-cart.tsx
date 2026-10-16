'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
        −
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
        ＋
      </button>
    </span>
  );
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
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (disabled)
    return (
      <div className="add">
        <button className="btn" type="button" disabled>
          現在は発注できません
        </button>
      </div>
    );
  return (
    <div className="add">
      <Stepper value={qty} onChange={setQty} label={name} />
      <button
        className="btn primary"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, qty }),
          });
          const body = await r.json().catch(() => ({}));
          setBusy(false);
          setMessage(
            r.ok
              ? `カートに入れました：${name} × ${qty}`
              : (body.error ?? '追加できませんでした。'),
          );
          if (r.ok) {
            setQty(1);
            router.refresh();
          }
          setTimeout(() => setMessage(''), 3500);
        }}
      >
        カートに入れる
      </button>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
