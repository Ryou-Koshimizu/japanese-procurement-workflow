import { test, expect, type Browser, type Page } from '@playwright/test';

// Every screen at 25 window sizes, from a folded phone (280×653) and landscape
// phones (568×320) to a 4K monitor: nothing scrolls sideways, no text is cut
// off, the header is 80px, the login hero fills the rest of the first screen
// with its heading, text and role buttons inside it, and every page keeps its
// heading and main action in the first screen.
const SIZES: [number, number][] = [
  [280, 653],
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [393, 852],
  [412, 915],
  [430, 932],
  [568, 320],
  [667, 375],
  [844, 390],
  [932, 430],
  [600, 960],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1024, 1366],
  [1180, 820],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

const HEADER = 80;

type Box = {
  name: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Layout facts measured in the page, so a failure names what broke. */
async function measure(page: Page) {
  return page.evaluate((HEADER) => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const problems: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/).join('.')}`
          : ''
      } "${(el.textContent ?? '').trim().slice(0, 24)}"`;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (e.getAttribute('aria-hidden') === 'true') return false;
        if (e.hasAttribute('inert')) return false;
      }
      return true;
    };
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return {
        name: name(el),
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      };
    };

    // Nothing scrolls sideways.
    const sw = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    if (sw > vw + 1) problems.push(`page is ${sw}px wide in a ${vw}px window`);

    // Nothing sticks out of the window, and no text is clipped by its box.
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el)) continue;
      if (el.closest('.scroll-x, .tabs, .ticker, .burst')) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1)
        problems.push(
          `${name(el)} sticks out (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`,
        );
      const cs = getComputedStyle(el);
      const clips =
        cs.overflowX === 'hidden' ||
        cs.overflowX === 'clip' ||
        cs.textOverflow === 'ellipsis';
      if (
        clips &&
        (el as HTMLElement).innerText?.trim() &&
        el.scrollWidth > el.clientWidth + 1 &&
        !el.querySelector('.ticker')
      )
        problems.push(
          `${name(el)} cuts its text (${el.scrollWidth} > ${el.clientWidth})`,
        );
    }

    // No text runs past the box it sits in (a name too long for its button).
    const blockOf = (el: Element) => {
      let e: Element | null = el;
      while (e && getComputedStyle(e).display.startsWith('inline'))
        e = e.parentElement;
      return e;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el)) continue;
      if (el.closest('.scroll-x, .tabs, .ticker, .burst')) continue;
      const host = blockOf(el);
      if (!host) continue;
      const hr = host.getBoundingClientRect();
      if (hr.width <= 1) continue;
      for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          if (r.right > hr.right + 1 || r.left < hr.left - 1)
            problems.push(
              `${name(el)} runs past its box (${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(hr.left)}–${Math.round(hr.right)})`,
            );
        }
      }
    }

    // The header is 80px.
    const top = document.querySelector('.top');
    const headerHeight = top ? top.getBoundingClientRect().height : 0;
    if (Math.abs(headerHeight - HEADER) > 0.5)
      problems.push(`header is ${headerHeight}px`);

    // The parts of the header never overlap.
    const parts = top
      ? [...top.querySelectorAll(':scope > *')].filter(shown).map(box)
      : [];
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i];
        const b = parts[j];
        if (
          a.left < b.right - 1 &&
          b.left < a.right - 1 &&
          a.top < b.bottom - 1 &&
          b.top < a.bottom - 1
        )
          problems.push(`${a.name} overlaps ${b.name}`);
      }

    // The first screen holds the heading and the marked main actions.
    const first = [
      ...document.querySelectorAll('main h1, [data-first]'),
    ].filter(shown);
    if (!first.length) problems.push('no heading in the first screen');
    for (const el of first) {
      const b = box(el);
      if (
        b.top < HEADER - 1 ||
        b.bottom > vh + 1 ||
        b.left < -1 ||
        b.right > vw + 1
      )
        problems.push(
          `${b.name} is outside the first screen (${Math.round(b.top)}–${Math.round(b.bottom)} of ${vh})`,
        );
    }

    // The login hero: exactly the rest of the screen, and its content inside.
    const hero = document.querySelector('[data-hero]');
    if (hero) {
      const h = hero.getBoundingClientRect();
      if (
        Math.abs(h.top - HEADER) > 1 ||
        Math.abs(h.height - (vh - HEADER)) > 1
      )
        problems.push(
          `hero is ${h.top}+${h.height}, expected ${HEADER}+${vh - HEADER}`,
        );
      const inside = [
        ...hero.querySelectorAll('h1, .lead, .sticker, h2, button, .hero-act'),
      ].filter(shown);
      for (const el of inside) {
        const b = box(el);
        if (b.top < HEADER - 1 || b.bottom > vh + 1)
          problems.push(
            `${b.name} is below the first screen (${Math.round(b.bottom)} of ${vh})`,
          );
      }
      const blocks = [...hero.querySelectorAll('h1, .lead, .hero-act')]
        .filter(shown)
        .map(box);
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i];
          const b = blocks[j];
          if (
            a.left < b.right - 1 &&
            b.left < a.right - 1 &&
            a.top < b.bottom - 1 &&
            b.top < a.bottom - 1
          )
            problems.push(`${a.name} overlaps ${b.name}`);
        }
    }
    return problems;
  }, HEADER);
}

async function signIn(page: Page, email: string) {
  const r = await page.request.post('/api/auth/login', {
    data: { email, password: 'demo-password-2026' },
  });
  expect(r.ok(), `login ${email}`).toBe(true);
}

async function check(page: Page, url: string, found: string[]) {
  await page.goto(url);
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  for (const p of await measure(page)) found.push(`${url}: ${p}`);
}

async function rowLinks(page: Page) {
  return page
    .locator('a.row-link')
    .evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!),
    );
}

async function contextAt(browser: Browser, w: number, h: number) {
  return browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: 'reduce',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
}

for (const [w, h] of SIZES) {
  test(`${w}×${h}: no sideways scroll, 80px header, first screen holds the main parts`, async ({
    browser,
  }) => {
    const found: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await contextAt(browser, w, h);
      const page = await ctx.newPage();
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      // Light is measured on every page; dark (same layout, other colors) on
      // the login hero only.
      await check(page, '/login', found);
      if (scheme === 'dark') {
        await ctx.close();
        continue;
      }

      await signIn(page, 'sato@sample-cafe.example.com');
      await check(page, '/', found);
      const mine = await rowLinks(page);
      await check(page, '/requests/new', found);
      await check(page, '/notifications', found);
      for (const href of mine.slice(0, 2)) await check(page, href, found);

      await ctx.clearCookies();
      await signIn(page, 'yamada@midori-kobai.example.com');
      await check(page, '/', found);
      await check(page, '/orders?tab=all', found);
      const all = await rowLinks(page);
      for (const href of all) await check(page, href, found);
      await check(page, '/makers', found);
      await check(page, '/catalog', found);

      await ctx.clearCookies();
      await signIn(page, 'tanaka@midori-kobai.example.com');
      for (const url of [
        '/admin/fields',
        '/admin/members',
        '/admin/audit',
        '/admin/catalog',
      ])
        await check(page, url, found);
      await check(page, '/no-such-page', found);
      await ctx.close();
    }
    expect(found).toEqual([]);
  });
}
