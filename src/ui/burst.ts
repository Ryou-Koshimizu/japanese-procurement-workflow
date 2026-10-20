// A short burst of paper from a button, for the moment an order is placed.
// Flat squares, bars and dots with the same thick outline as the rest of the
// screen; they fly up, tumble and fall within a second, then are removed.
// Nothing happens under reduced motion.
import { stillMotion } from './press-button';

const COLORS = [
  '#ffd23f',
  '#ff9ebb',
  '#7fd6ff',
  '#b6f36b',
  '#c3b2ff',
  '#ffb45c',
];

export const BURST_MS = 1000;

export function burst(from: Element | null | undefined, pieces = 26) {
  if (!from || stillMotion() || typeof document === 'undefined') return;
  const r = from.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  for (let i = 0; i < pieces; i++) {
    const p = document.createElement('i');
    const shape = i % 3;
    const size = 9 + Math.round(Math.random() * 7);
    p.style.width = `${shape === 1 ? size * 0.55 : size}px`;
    p.style.height = `${shape === 1 ? size * 1.6 : size}px`;
    p.style.background = COLORS[i % COLORS.length];
    if (shape === 2) p.style.borderRadius = '50%';
    p.style.left = `${x0}px`;
    p.style.top = `${y0}px`;
    layer.append(p);
    // Up and out in a fan, then gravity pulls them down past the start.
    const angle = (-90 + (Math.random() * 2 - 1) * 70) * (Math.PI / 180);
    const speed = 170 + Math.random() * 190;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const spin = (Math.random() * 2 - 1) * 540;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const x = vx * t;
      const y = vy * t + 520 * t * t;
      frames.push({
        transform: `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg) scale(${k === 0 ? 0.4 : 1})`,
        opacity: t > 0.8 ? (1 - t) * 5 : 1,
      });
    }
    p.animate(frames, {
      duration: BURST_MS * (0.8 + Math.random() * 0.2),
      easing: 'linear',
      fill: 'forwards',
    });
  }
  setTimeout(() => layer.remove(), BURST_MS + 100);
}
