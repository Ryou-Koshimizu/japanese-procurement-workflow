import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { quoteTotals, sellingPrice, yen } from '../src/core/money';

// Runs against the demo (APP_MODE=demo): A社 株式会社サンプルカフェ with three
// branches, B社 みどり購買サポート and three registered makers, all fictional.
// The server starts fresh, so the demo holds R-2026-0001…0007 and the request
// sent here becomes the next number.

/** Wait until the page has hydrated, so a click reaches its handler. */
async function ready(page: Page) {
  await page.locator('html[data-ready]').waitFor({ state: 'attached' });
}

async function login(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await ready(page);
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.waitForURL('/');
  await ready(page);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await ready(page);
}

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    r.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join(' | ')}`,
    ),
    page.url(),
  ).toEqual([]);
}

/** A date in Japan, `days` from today, as YYYY-MM-DD. */
function japanDate(days: number) {
  const t = new Date(Date.now() + 9 * 3600_000 + days * 86400_000);
  return t.toISOString().slice(0, 10);
}
const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}年${m}月${day}日`;
};

test.describe.configure({ mode: 'serial' });

// What the test enters. The costs are B社's; A社 must never see them.
const TITLE = 'バックヤードの作業台';
const QUESTION = '作業台の天板は木目とステンレスのどちらがよいですか？';
const ANSWER = 'ステンレスでお願いします。水を使います。';
const LINES = [
  { name: 'ステンレス作業台', spec: 'W1500×D600×H850', qty: 1, unit: '台' },
  { name: '作業台用の棚板', spec: 'W1500用', qty: 2, unit: '枚' },
];
const MAKERS = {
  aoba: { name: /あおば/, costs: [41300, 2870], shipping: 1850 },
  hikari: { name: /ひかり/, costs: [44100, 3150], shipping: 2240 },
};
const MARKUP_PCT = 20;
const SHIPPING_TO_CLIENT = 5000;
// あおば is the cheaper one, so the quote builder starts from it.
const prices = MAKERS.aoba.costs.map((c) => sellingPrice(c, MARKUP_PCT * 100));
const expected = quoteTotals(
  LINES.map((l, i) => ({ unitPrice: prices[i], qty: l.qty, taxRate: 10 })),
  SHIPPING_TO_CLIENT,
);
const costFigures = Object.values(MAKERS).flatMap((m) => [
  ...m.costs,
  m.shipping,
  m.costs.reduce((n, c, i) => n + c * LINES[i].qty, m.shipping),
]);
const DELIVERY = japanDate(14);

let orderUrl = '';

test('A社 sends a request through the intake form', async ({ page }) => {
  await login(page, '佐藤');
  await open(page, '/requests/new');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Required answers are checked before anything is sent.
  await page.getByRole('button', { name: 'B社に依頼を送る' }).click();
  await expect(
    page.locator('.alert', { hasText: '入力内容を確認してください。' }),
  ).toBeVisible();
  await page.locator('#title').fill(TITLE);
  await page.locator('#f-item').fill('作業台');
  await page.locator('#f-purpose').fill('仕込みの場所が足りないため。');
  await page.locator('#f-place').fill('バックヤードの奥');
  await page.locator('#f-quantity').fill('1');
  await page.getByRole('button', { name: 'B社に依頼を送る' }).click();
  await page.waitForURL(/\/orders\//);
  await ready(page);
  await expect(page.locator('h1')).toContainText(TITLE);
  await expect(page.getByLabel('次にやること')).toContainText(
    'B社が依頼を確認しています',
  );
  orderUrl = page.url();
});

test('B社 asks a question and A社 answers it', async ({ page }) => {
  await login(page, '山田');
  await open(page, orderUrl);
  await page.locator('#msg-question').fill(QUESTION);
  await page.getByRole('button', { name: '質問を送る' }).click();
  await expect(page.locator('.thread')).toContainText(QUESTION);
  await ready(page);
  await expect(page.getByLabel('次にやること')).toContainText(
    'A社の回答を待っています',
  );

  await login(page, '佐藤');
  await open(page, orderUrl);
  await expect(page.getByLabel('次にやること')).toContainText(
    'B社からの質問に答えてください',
  );
  await page.locator('#msg-answer').fill(ANSWER);
  await page.getByRole('button', { name: '回答を送る' }).click();
  await expect(page.locator('.thread')).toContainText(ANSWER);
});

test('B社 fixes the outline, asks two makers and records their replies', async ({
  page,
}) => {
  await login(page, '山田');
  await open(page, orderUrl);
  for (const [i, l] of LINES.entries()) {
    if (i > 0) await page.getByRole('button', { name: '行を追加' }).click();
    await page.locator(`#r${i}-name`).fill(l.name);
    await page.locator(`#r${i}-spec`).fill(l.spec);
    await page.locator(`#r${i}-qty`).fill(String(l.qty));
    await page.locator(`#r${i}-unit`).fill(l.unit);
  }
  await page.getByRole('button', { name: '商品概要を確定する' }).click();
  await expect(
    page.getByRole('button', { name: '商品概要を直す' }),
  ).toBeVisible();
  await ready(page);

  await page.getByRole('checkbox', { name: MAKERS.aoba.name }).check();
  await page.getByRole('checkbox', { name: MAKERS.hikari.name }).check();
  await page.getByRole('button', { name: '2社に見積を依頼する' }).click();
  const card = (name: RegExp) =>
    page.locator('article.mq', {
      has: page.getByRole('heading', { name }),
    });
  await expect(card(MAKERS.aoba.name)).toBeVisible();
  await ready(page);

  for (const m of Object.values(MAKERS)) {
    const c = card(m.name);
    await c.getByRole('button', { name: '受け取った見積を入力' }).click();
    for (const [i, cost] of m.costs.entries())
      await c.locator(`input[id$="-cost-${i}"]`).fill(String(cost));
    await c.locator('input[id$="-ship"]').fill(String(m.shipping));
    await c.locator('input[id$="-lead"]').fill('受注後10日');
    await c.getByRole('button', { name: /の見積を記録する$/ }).click();
    await expect(card(m.name)).toContainText('原価計');
    await ready(page);
  }
  // Both replies are compared; the cheaper one is marked.
  const table = page.getByRole('table', { name: '受け取った見積の比較' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(
    table.getByRole('row', { name: MAKERS.aoba.name }),
  ).toContainText('最安');
});

test('B社 issues a quote with a markup on the cost', async ({ page }) => {
  await login(page, '山田');
  await open(page, orderUrl);
  await page.getByRole('radio', { name: '原価に率を載せる' }).check();
  await page.locator('#qb-pct').fill(String(MARKUP_PCT));
  await page.locator('#qb-ship').fill(String(SHIPPING_TO_CLIENT));
  await page.locator('#qb-exp').fill('0');
  // Unit price = ceil(cost × (10000 + bp) / 10000), previewed before sending.
  const preview = page.getByRole('table', { name: '見積書のプレビュー' });
  for (const p of prices) await expect(preview).toContainText(yen(p));
  await page
    .getByRole('button', {
      name: `見積書をA社に送る（${yen(expected.total)}）`,
    })
    .click();
  await expect(page.locator('.quote-head')).toContainText('第1版');
  await ready(page);
  await expect(page.getByLabel('次にやること')).toContainText(
    'A社の合意を待っています',
  );
});

test('A社 sees the total, never the costs or the makers, and agrees', async ({
  page,
}) => {
  await login(page, '佐藤');
  await open(page, orderUrl);
  const quote = page.locator('#quote');
  await expect(quote.locator('.totals .grand')).toContainText(
    yen(expected.total),
  );
  for (const p of prices) await expect(quote).toContainText(yen(p));

  const text = await page.locator('body').innerText();
  const html = await page.content();
  for (const c of costFigures) {
    const shown = c.toLocaleString('ja-JP');
    expect(text, `cost ${shown} is on A社's page`).not.toContain(shown);
    expect(html, `cost ${shown} is in A社's HTML`).not.toContain(shown);
  }
  for (const maker of ['さくら', 'あおば', 'ひかり']) {
    expect(html, `${maker} is in A社's HTML`).not.toContain(maker);
  }
  for (const word of ['原価', 'B社だけに見えます'])
    expect(text).not.toContain(word);

  await page.getByRole('button', { name: '合意する', exact: true }).click();
  await expect(page.getByRole('group', { name: '合意の確認' })).toContainText(
    yen(expected.total),
  );
  await page.getByRole('button', { name: 'この見積書で合意する' }).click();
  await expect(page.getByLabel('次にやること')).toContainText(
    'B社がメーカーに発注します',
  );
});

test('B社 orders from the maker and sets the delivery date', async ({
  page,
}) => {
  await login(page, '山田');
  await open(page, orderUrl);
  await page.getByRole('radio', { name: 'メーカーから直送' }).check();
  await expect(page.locator('#order')).toContainText('渋谷区');
  await page.getByRole('button', { name: 'メーカーに発注する' }).click();
  await expect(page.locator('#order')).toContainText(/PO-\d{4}-\d{4}/);
  await ready(page);

  await page.locator('#delivery-date').fill(DELIVERY);
  await page
    .getByRole('button', { name: '納期を確定してA社に知らせる' })
    .click();
  await expect(page.locator('.notice-mail')).toContainText(
    `納期：${longDate(DELIVERY)}`,
  );
  await expect(page.locator('h1')).toContainText('納期確定');
});

test('A社 finds the delivery notice with the date and the total', async ({
  page,
}) => {
  await login(page, '佐藤');
  await open(page, '/notifications');
  // The demo already holds one notice (R-2026-0001); this is the new one.
  const mail = page
    .locator('details.mail')
    .filter({ hasText: `【納期のお知らせ】${TITLE}` });
  await expect(mail).toHaveCount(1);
  await mail.locator('summary').click();
  const body = mail.locator('pre');
  await expect(body).toContainText(`納期：${longDate(DELIVERY)}`);
  await expect(body).toContainText(`合計（税込）：${yen(expected.total)}`);
  await expect(body).not.toContainText(MAKERS.aoba.name);
});

test('the other side and other branches are refused', async ({ page }) => {
  const id = orderUrl.split('/').pop();
  // 鈴木 works at 梅田店; the request belongs to 渋谷店.
  await login(page, '鈴木');
  const r = await page.goto(orderUrl);
  expect(r?.status()).toBe(404);
  const peek = await page.request.get(orderUrl);
  expect(await peek.text()).not.toContain(TITLE);

  // A社 cannot use B社's actions.
  await login(page, '佐藤');
  const schedule = await page.request.post(`/api/orders/${id}/schedule`, {
    data: { delivery_date: japanDate(20) },
  });
  expect(schedule.status()).toBe(403);
  const makers = await page.request.post(`/api/orders/${id}/maker-quotes`, {
    data: { makerIds: [] },
  });
  expect(makers.status()).toBe(403);

  // Cross-site posts are refused before anything runs.
  await login(page, '山田');
  const forged = await page.request.post(`/api/orders/${id}/reject`, {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    data: { reason: 'x' },
  });
  expect(forged.status()).toBe(403);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the main screens pass accessibility checks (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await login(page, '佐藤');
    await noA11yViolations(page); // home
    await open(page, '/requests/new');
    await noA11yViolations(page);
    // A quote waiting for A社 (R-2026-0003) and the finished request.
    await open(page, '/');
    await page
      .getByRole('link', { name: /レジ回りの消耗品/ })
      .first()
      .click();
    await ready(page);
    await noA11yViolations(page);
    await open(page, orderUrl);
    await noA11yViolations(page);
    await open(page, '/notifications');
    await noA11yViolations(page);

    await login(page, '山田');
    await noA11yViolations(page); // home
    // Comparing two maker quotes with the quote builder open (R-2026-0004).
    await open(page, '/orders?tab=all');
    await page.getByRole('link', { name: /客席の椅子の追加/ }).click();
    await ready(page);
    await expect(
      page.getByRole('table', { name: '受け取った見積の比較' }),
    ).toBeVisible();
    await noA11yViolations(page);
    await open(page, orderUrl);
    await noA11yViolations(page);
    await open(page, '/makers');
    await noA11yViolations(page);
    await open(page, '/notifications');
    await noA11yViolations(page);
  });
}
