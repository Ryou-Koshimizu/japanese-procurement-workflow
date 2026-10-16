// Flat product drawings for the fictional supplier: no outlines, three-face
// shading (front = base, side darker, top lighter), no text or logos.
// 240×240 canvas, exported at 480×480.
import type { DemoProduct } from '../../src/demo/supplier-data';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Lighten (amount > 0) toward white or darken (amount < 0) toward a cool slate. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount >= 0 ? [255, 255, 255] : [24, 32, 48];
  const t = Math.abs(amount);
  const mix = (a: number, z: number) => Math.round(a + (z - a) * t);
  return `#${[mix(r, target[0]), mix(g, target[1]), mix(b, target[2])]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A box seen from the front-right: front face, side face, top face. */
function box(
  x: number,
  y: number,
  w: number,
  h: number,
  d: number,
  color: string,
  extra = '',
): string {
  const dx = f(d * 0.62);
  const dy = f(d * 0.38);
  return `
  <polygon points="${x},${y} ${x + dx},${y - dy} ${x + w + dx},${y - dy} ${x + w},${y}" fill="${shade(color, 0.14)}"/>
  <polygon points="${x + w},${y} ${x + w + dx},${y - dy} ${x + w + dx},${y + h - dy} ${x + w},${y + h}" fill="${shade(color, -0.16)}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>${extra}`;
}

function cylinder(
  cx: number,
  top: number,
  rx: number,
  ry: number,
  h: number,
  color: string,
  topFill?: string,
): string {
  return `
  <path d="M${cx - rx},${top} v${h} a${rx},${ry} 0 0 0 ${rx * 2},0 v${-h} z" fill="${shade(color, -0.1)}"/>
  <path d="M${cx - rx},${top} v${h} a${rx},${ry} 0 0 0 ${rx},${ry} v${-h} a${rx},${ry} 0 0 1 ${-rx},${-ry} z" fill="${color}"/>
  <ellipse cx="${cx}" cy="${top}" rx="${rx}" ry="${ry}" fill="${topFill ?? shade(color, 0.16)}"/>`;
}

const highlight = (x: number, y: number, w: number, h: number, r = 4) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#ffffff" opacity="0.32"/>`;

function drawing(p: DemoProduct): string {
  const { color: c, accent: a } = p;
  switch (p.art) {
    case 'ream':
      return [0, 1, 2]
        .map((i) =>
          box(
            52,
            160 - i * 34,
            112,
            34,
            46,
            c,
            `<rect x="52" y="${170 - i * 34}" width="112" height="12" fill="${a}"/>
             <rect x="52" y="${170 - i * 34}" width="112" height="3" fill="${shade(a, 0.3)}"/>`,
          ),
        )
        .join('');
    case 'pump':
      return `
  <rect x="112" y="46" width="16" height="12" rx="3" fill="${shade(a, -0.1)}"/>
  <rect x="118" y="40" width="34" height="8" rx="4" fill="${shade(a, -0.1)}"/>
  <rect x="146" y="40" width="6" height="16" rx="3" fill="${shade(a, -0.1)}"/>
  <rect x="104" y="56" width="32" height="20" rx="5" fill="${a}"/>
  <rect x="80" y="72" width="80" height="124" rx="22" fill="${c}"/>
  <rect x="80" y="72" width="80" height="124" rx="22" fill="${shade(c, -0.06)}" clip-path="inset(0 0 0 60%)"/>
  <rect x="90" y="112" width="60" height="48" rx="8" fill="${a}"/>
  <rect x="98" y="124" width="30" height="6" rx="3" fill="#ffffff" opacity="0.8"/>
  <rect x="98" y="136" width="20" height="6" rx="3" fill="#ffffff" opacity="0.6"/>
  ${highlight(88, 82, 8, 98)}`;
    case 'pouch':
      return `
  <rect x="134" y="44" width="22" height="18" rx="4" fill="${shade(c, -0.25)}"/>
  <path d="M74,56 h92 l10,132 q-56,16 -112,0 z" fill="${c}"/>
  <path d="M120,56 h46 l10,132 q-28,8 -56,8 z" fill="${shade(c, -0.08)}"/>
  <rect x="74" y="56" width="92" height="10" fill="${shade(c, -0.18)}"/>
  <ellipse cx="120" cy="132" rx="34" ry="30" fill="${a}"/>
  <path d="M106,136 q14,-26 28,0 q-14,14 -28,0 z" fill="${c}" opacity="0.7"/>
  ${highlight(86, 74, 7, 92)}`;
    case 'roll': {
      const roll = (cx: number, top: number) =>
        cylinder(cx, top, 30, 11, 54, c, shade(c, 0.4)) +
        `<ellipse cx="${cx}" cy="${top}" rx="22" ry="8" fill="${shade(c, -0.05)}"/>
         <ellipse cx="${cx}" cy="${top}" rx="7" ry="3" fill="${a}"/>
         <rect x="${cx - 30}" y="${top + 20}" width="60" height="5" fill="${a}" opacity="0.55"/>`;
      return roll(92, 92) + roll(150, 92) + roll(121, 128);
    }
    case 'bags':
      return `
  <path d="M86,92 q34,-42 70,0 l-6,40 h-58 z" fill="${c}" opacity="0.85"/>
  <path d="M100,94 q20,-22 40,0" fill="none" stroke="${shade(c, -0.2)}" stroke-width="3" stroke-linecap="round"/>
  ${box(
    56,
    104,
    118,
    88,
    44,
    a,
    `<rect x="72" y="124" width="86" height="34" rx="6" fill="${shade(a, 0.75)}"/>
     <rect x="80" y="134" width="40" height="6" rx="3" fill="${a}"/>
     <rect x="80" y="144" width="60" height="5" rx="2.5" fill="${a}" opacity="0.6"/>`,
  )}`;
    case 'pens':
      return [-24, -12, 0, 12, 24]
        .map(
          (deg, i) => `
  <g transform="rotate(${deg} 120 196)">
    <rect x="114" y="52" width="12" height="128" rx="5" fill="${i % 2 ? shade(c, 0.12) : c}"/>
    <rect x="114" y="52" width="12" height="22" rx="5" fill="${a}"/>
    <rect x="124" y="58" width="4" height="34" rx="2" fill="${shade(a, -0.2)}"/>
    <polygon points="114,180 126,180 120,196" fill="${shade(a, 0.3)}"/>
  </g>`,
        )
        .join('');
    case 'battery':
      return `
  <rect x="52" y="54" width="136" height="150" rx="12" fill="${shade(a, 0.86)}"/>
  <rect x="52" y="54" width="136" height="26" rx="12" fill="${shade(a, 0.7)}"/>
  <circle cx="120" cy="66" r="6" fill="${shade(a, 0.95)}"/>
  ${[66, 96, 126, 156]
    .map(
      (x) => `
  <rect x="${x + 7}" y="88" width="10" height="8" rx="2" fill="#c9ced6"/>
  <rect x="${x}" y="94" width="24" height="96" rx="5" fill="${c}"/>
  <rect x="${x}" y="150" width="24" height="40" rx="5" fill="${a}"/>
  <rect x="${x}" y="150" width="24" height="8" fill="${a}"/>
  ${highlight(x + 4, 100, 5, 84, 2.5)}`,
    )
    .join('')}`;
    case 'case': {
      const drinks = p.category === '来客用飲料';
      const caps = drinks
        ? [0, 1, 2, 3]
            .flatMap((col) =>
              [0, 1].map(
                (row) =>
                  `<ellipse cx="${f(70 + col * 25 + row * 16)}" cy="${f(96 - row * 10)}" rx="8" ry="4" fill="${shade(c, 0.2)}"/>`,
              ),
            )
            .join('')
        : '';
      return (
        box(
          56,
          100,
          120,
          96,
          52,
          drinks ? '#d9b98a' : c,
          `<rect x="56" y="132" width="120" height="30" fill="${a}"/>
         <rect x="68" y="141" width="44" height="12" rx="6" fill="${drinks ? c : shade(c, -0.15)}"/>
         <rect x="56" y="100" width="120" height="6" fill="${shade(drinks ? '#d9b98a' : c, -0.08)}"/>`,
        ) + caps
      );
    }
    case 'bulb':
      return `
  <circle cx="120" cy="96" r="60" fill="#fde68a" opacity="0.35"/>
  <circle cx="120" cy="92" r="42" fill="${c}"/>
  <path d="M120,50 a42,42 0 0 1 0,84 z" fill="${shade(c, -0.05)}"/>
  <path d="M96,124 h48 l-6,22 h-36 z" fill="${shade(c, -0.03)}"/>
  ${[148, 160, 172]
    .map(
      (y) =>
        `<rect x="100" y="${y}" width="40" height="9" rx="4" fill="${a}"/>`,
    )
    .join('')}
  <path d="M106,184 h28 l-8,14 h-12 z" fill="${shade(a, -0.35)}"/>
  ${highlight(98, 70, 8, 30)}`;
    case 'mop':
      return `
  <g transform="rotate(10 120 120)">
    <rect x="115" y="18" width="10" height="132" rx="5" fill="${shade(c, 0.15)}"/>
    <rect x="111" y="16" width="18" height="16" rx="6" fill="${c}"/>
    <rect x="94" y="142" width="52" height="16" rx="6" fill="${c}"/>
    <path d="M90,154 h60 q10,26 6,46 q-36,10 -72,0 q-4,-20 6,-46 z" fill="${a}"/>
    <path d="M120,154 h30 q10,26 6,46 q-18,5 -36,5 z" fill="${shade(a, -0.08)}"/>
    ${[98, 108, 118, 128, 138].map((x) => `<path d="M${x},160 q${(x - 118) / 6},18 ${(x - 118) / 3},38" fill="none" stroke="${shade(a, -0.18)}" stroke-width="2" stroke-linecap="round"/>`).join('')}
  </g>`;
    case 'broom':
      return `
  <path d="M140,150 h52 l8,44 h-68 z" fill="${c}"/>
  <path d="M132,194 h68 l-4,8 h-60 z" fill="${shade(c, -0.2)}"/>
  <rect x="160" y="96" width="8" height="56" rx="4" fill="${shade(c, -0.1)}"/>
  <g transform="rotate(-12 96 120)">
    <rect x="91" y="22" width="10" height="126" rx="5" fill="${shade(a, -0.35)}"/>
    <path d="M78,144 h36 l16,54 h-68 z" fill="${a}"/>
    <rect x="78" y="144" width="36" height="10" rx="3" fill="${c}"/>
    ${[70, 84, 98, 112].map((x) => `<rect x="${x}" y="164" width="3" height="32" rx="1.5" fill="${shade(a, -0.15)}"/>`).join('')}
  </g>`;
    case 'tissue-box':
      return (
        box(
          52,
          104,
          124,
          84,
          58,
          c,
          `<rect x="66" y="130" width="96" height="34" rx="8" fill="${a}"/>
         <rect x="76" y="141" width="46" height="6" rx="3" fill="${c}" opacity="0.7"/>`,
        ) +
        `
  <ellipse cx="136" cy="93" rx="36" ry="9" fill="${shade(c, -0.35)}"/>
  <path d="M112,94 q8,-34 24,-30 q14,-12 26,4 q-6,18 -14,28 z" fill="${a === '#d9822b' ? '#ffffff' : a}"/>
  <path d="M124,90 q6,-20 14,-22" fill="none" stroke="${shade(c, 0.4)}" stroke-width="2.5" stroke-linecap="round"/>`
      );
    case 'towels':
      return [0, 1, 2]
        .map(
          (i) => `
  <rect x="${58 + i * 6}" y="${150 - i * 36}" width="${124 - i * 12}" height="40" rx="16" fill="${i === 1 ? shade(c, -0.08) : c}"/>
  <rect x="${86 + i * 6}" y="${156 - i * 36}" width="${66 - i * 12}" height="14" rx="7" fill="${a}"/>
  <rect x="${92 + i * 6}" y="${160 - i * 36}" width="${30 - i * 4}" height="6" rx="3" fill="${shade(c, -0.2)}"/>`,
        )
        .join('');
    case 'wrap':
      return (
        box(
          40,
          132,
          150,
          40,
          40,
          c,
          `<rect x="40" y="132" width="150" height="10" fill="${shade(c, 0.2)}"/>
         <rect x="56" y="150" width="70" height="8" rx="4" fill="${a}"/>
         <path d="M40,172 ${Array.from({ length: 15 }, (_, i) => `l5,4 l5,-4`).join(' ')}" fill="none" stroke="${shade(c, -0.3)}" stroke-width="2"/>`,
        ) +
        `
  <ellipse cx="205" cy="138" rx="9" ry="15" fill="${a}"/>
  <ellipse cx="205" cy="138" rx="3" ry="6" fill="${shade(a, -0.3)}"/>`
      );
    case 'files':
      return [-8, 0, 8]
        .map(
          (deg, i) => `
  <g transform="rotate(${deg} 120 130)">
    <path d="M70,${60 + i * 6} h82 l18,18 v104 h-100 z" fill="${i === 2 ? a : c}" opacity="${0.55 + i * 0.15}"/>
    <path d="M152,${60 + i * 6} v18 h18" fill="${shade(c, -0.2)}" opacity="0.6"/>
    <rect x="84" y="${100 + i * 6}" width="56" height="6" rx="3" fill="#ffffff" opacity="0.7"/>
    <rect x="84" y="${112 + i * 6}" width="40" height="6" rx="3" fill="#ffffff" opacity="0.55"/>
  </g>`,
        )
        .join('');
    case 'tape': {
      const tape = (cx: number, top: number) =>
        cylinder(cx, top, 40, 15, 26, c, shade(c, 0.22)) +
        `<ellipse cx="${cx}" cy="${top}" rx="18" ry="7" fill="${shade(a, 0.6)}"/>
         <ellipse cx="${cx}" cy="${top + 1}" rx="14" ry="5" fill="#f3f1e7"/>`;
      return tape(120, 156) + tape(120, 122) + tape(120, 88);
    }
    case 'drip':
      return (
        box(
          46,
          96,
          120,
          92,
          50,
          c,
          `<rect x="60" y="114" width="92" height="40" rx="6" fill="${shade(c, 0.85)}"/>
         ${[66, 88, 110, 132].map((x) => `<rect x="${x}" y="120" width="16" height="28" rx="2" fill="${shade(c, 0.55)}"/>`).join('')}
         <rect x="60" y="164" width="50" height="8" rx="4" fill="${a}"/>`,
        ) +
        `
  <g transform="rotate(8 186 160)">
    <rect x="162" y="128" width="46" height="58" rx="4" fill="${a}"/>
    <path d="M168,128 v-8 h10 v8 M192,128 v-8 h10 v8" fill="none" stroke="${shade(c, 0.3)}" stroke-width="3"/>
    <rect x="170" y="146" width="30" height="5" rx="2.5" fill="${c}" opacity="0.6"/>
  </g>`
      );
    case 'spray':
      return `
  <rect x="96" y="40" width="30" height="20" rx="5" fill="${shade(c, -0.3)}"/>
  <path d="M74,72 q0,-14 16,-14 h52 q34,0 34,40 v86 q0,12 -12,12 h-78 q-12,0 -12,-12 z" fill="${c}"/>
  <path d="M142,58 q34,0 34,40 v86 q0,12 -12,12 h-22 z" fill="${shade(c, -0.08)}"/>
  <rect x="142" y="78" width="22" height="34" rx="10" fill="#eef5e9"/>
  <rect x="84" y="120" width="64" height="54" rx="10" fill="${a}"/>
  <path d="M104,154 q12,-28 24,0 q-12,10 -24,0 z" fill="${c}"/>
  ${highlight(82, 76, 7, 90)}`;
    case 'paper-bag':
      return `
  <polygon points="150,70 178,58 184,192 156,200" fill="${shade(c, -0.16)}"/>
  <polygon points="150,70 178,58 172,52 144,62" fill="${shade(c, 0.1)}"/>
  <rect x="62" y="70" width="94" height="130" fill="${c}"/>
  <path d="M62,70 ${Array.from({ length: 9 }, (_, i) => `l${i % 2 ? 6 : 5},${i % 2 ? -5 : 5}`).join(' ')} l${94 - 9 * 5.5},0 v-0 z" fill="${shade(c, 0.12)}"/>
  <rect x="62" y="70" width="94" height="8" fill="${shade(c, 0.12)}"/>
  <rect x="82" y="120" width="54" height="30" rx="15" fill="${a}" opacity="0.55"/>`;
    case 'markers': {
      const colors = ['#e5484d', '#3b82c4', '#2b3442', '#3f9a5a', '#e08a2b'];
      return colors
        .map((col, i) => {
          const x = 62 + i * 24;
          const top = 64 + (i % 2) * 14;
          return `
  <rect x="${x}" y="${top + 26}" width="20" height="${196 - top - 26}" rx="6" fill="${shade(col, 0.88)}"/>
  <rect x="${x + 12}" y="${top + 26}" width="8" height="${196 - top - 26}" fill="${shade(col, 0.72)}"/>
  <rect x="${x}" y="${top + 64}" width="20" height="44" fill="${col}"/>
  <rect x="${x}" y="${top}" width="20" height="32" rx="6" fill="${col}"/>
  <rect x="${x}" y="${top + 28}" width="20" height="6" fill="${shade(col, -0.25)}"/>`;
        })
        .join('');
    }
  }
}

export function artSvg(p: DemoProduct, tint: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 240 240">
  <rect width="240" height="240" fill="${tint}"/>
  <ellipse cx="120" cy="204" rx="78" ry="10" fill="#0f172a" opacity="0.08"/>
  ${drawing(p)}
</svg>`;
}
