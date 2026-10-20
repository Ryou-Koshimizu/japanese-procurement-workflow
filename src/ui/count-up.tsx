'use client';
import { useEffect, useState } from 'react';
import { stillMotion } from './press-button';

/**
 * A number that counts up from 0 once, after the page has arrived. The
 * server renders the final text, so it reads right without JavaScript, and
 * screen readers get the final value from a visually hidden copy.
 */
export function CountUp({
  value,
  unit = 'count',
  ms = 900,
}: {
  value: number;
  /** 「3件」 or 「¥12,345」. A name, not a function: servers render this. */
  unit?: 'count' | 'yen';
  ms?: number;
}) {
  const format = unit === 'yen' ? yenText : countText;
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (stillMotion() || value <= 0) return;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 4))));
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    setShown(0);
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden="true">{format(shown)}</span>
    </>
  );
}

export const yenText = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
export const countText = (n: number) => `${n}件`;
