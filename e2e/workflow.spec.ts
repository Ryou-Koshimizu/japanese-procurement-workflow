import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { quoteTotals, yen } from '../src/core/money';

// Runs against the demo (APP_MODE=demo): a fictional company with three
// stores, headquarters and a catalog imported from the bundled supplier site.

async function login(page: Page, name: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.waitForURL('/');
}

async function noA11yViolations(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

let orderUrl = '';

test('a store requests supplies from the catalog', async ({ page }) => {
  await login(page, '伊藤');
  await page.getByRole('link', { name: 'カタログ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'カタログ' })).toBeVisible();
  // The hidden item is not offered to stores; the out-of-stock one cannot be ordered.
  await expect(page.getByText('LED電球 60W形相当')).toHaveCount(0);
  const towels = page.locator('article', { hasText: 'ペーパータオル 中判' });
  await expect(
    towels.getByRole('button', { name: '現在は発注できません' }),
  ).toBeDisabled();
  await noA11yViolations(page);

  const paper = page.locator('article', { hasText: 'コピー用紙 A4' });
  await paper.getByRole('button', { name: /数量を増やす/ }).click();
  await paper.getByRole('button', { name: 'カートに入れる' }).click();
  await expect(page.getByRole('status')).toContainText(
    'コピー用紙 A4 500枚×5冊 × 2',
  );
  const tea = page.locator('article', { hasText: '緑茶 ペットボトル' });
  await tea.getByRole('button', { name: 'カートに入れる' }).click();
  await expect(
    page.getByRole('navigation', { name: 'メニュー' }),
  ).toContainText('3');

  await page.getByRole('link', { name: 'カートを確認して依頼する' }).click();
  // Reference total: 2 × ¥2,180 (10%) + 1 × ¥2,600 (8%).
  const ref = quoteTotals([
    { unitPrice: 2180, qty: 2, taxRate: 10 },
    { unitPrice: 2600, qty: 1, taxRate: 8 },
  ]);
  await expect(page.locator('.totals .grand')).toContainText(yen(ref.total));
  await noA11yViolations(page);
  await page
    .getByLabel('本社へのメモ（任意）')
    .fill('コピー用紙が残り1冊です。');
  await page.getByRole('button', { name: '本社に依頼する' }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.locator('h1')).toContainText('本社の確認待ち');
  orderUrl = page.url();
});

test('headquarters approves the request by sending a quote', async ({
  page,
}) => {
  await login(page, '山田');
  await page.goto(orderUrl);
  await expect(
    page.getByRole('heading', { name: '承認して見積を送る' }),
  ).toBeVisible();
  await page.getByLabel('コピー用紙 A4 500枚×5冊の単価').fill('2000');
  await page.getByLabel('送料（税抜・10%対象）').fill('500');
  const expected = quoteTotals(
    [
      { unitPrice: 2000, qty: 2, taxRate: 10 },
      { unitPrice: 2600, qty: 1, taxRate: 8 },
    ],
    500,
  );
  await noA11yViolations(page);
  await page
    .getByRole('button', {
      name: `承認して見積を送る（${yen(expected.total)}）`,
    })
    .click();
  await expect(page.locator('h1')).toContainText('店舗の承諾待ち');
  // The amounts shown are the ones the database computed.
  await expect(
    page
      .locator('section', { hasText: '本社からの見積' })
      .locator('.totals .grand'),
  ).toContainText(yen(expected.total));
  // Headquarters cannot answer its own quote.
  await expect(
    page.getByRole('button', { name: 'この見積で発注する' }),
  ).toHaveCount(0);
});

test('other stores cannot see the request', async ({ page }) => {
  await login(page, '鈴木');
  const r = await page.goto(orderUrl);
  expect(r?.status()).toBe(404);
});

test('the store accepts and the order is placed with the amount sent to both', async ({
  page,
}) => {
  await login(page, '伊藤');
  await page.goto(orderUrl);
  const total = yen(
    quoteTotals(
      [
        { unitPrice: 2000, qty: 2, taxRate: 10 },
        { unitPrice: 2600, qty: 1, taxRate: 8 },
      ],
      500,
    ).total,
  );
  await page.getByRole('button', { name: 'この見積で発注する' }).click();
  await expect(page.getByRole('group', { name: '発注の確認' })).toContainText(
    total,
  );
  await page.getByRole('button', { name: '発注を確定する' }).click();
  await expect(page.locator('h1')).toContainText('発注済み');
  await expect(page.locator('.agreed')).toContainText(total);
  await expect(page.locator('.agreed')).toContainText('本社の承認：山田 花子');
  await expect(page.locator('.agreed')).toContainText(
    '店舗の承諾：伊藤 さくら',
  );
  const po = (await page.locator('h1').innerText()).match(/PO-\d{4}-\d{4}/)![0];

  await page.getByRole('link', { name: '通知', exact: true }).click();
  await expect(
    page.getByText(`【発注確定】${po} 大宮店 合計 ${total}（税込）`),
  ).toBeVisible();
  await noA11yViolations(page);

  await login(page, '山田');
  await page.getByRole('link', { name: '通知', exact: true }).click();
  await expect(
    page.getByText(`【発注確定】${po} 大宮店 合計 ${total}（税込）`),
  ).toBeVisible();
  // The supplier receives the purchase order.
  await expect(
    page.getByText(
      new RegExp(`【発注書】${po} .* 合計 ${total.replace('¥', '\\¥')}`),
    ),
  ).toBeVisible();
});

test('the workflow refuses actions of the wrong side', async ({ page }) => {
  await login(page, '佐藤');
  const id = orderUrl.split('/').pop();
  // A store cannot quote, headquarters cannot accept (checked by the database).
  const quote = await page.request.post(`/api/orders/${id}/quote`, {
    data: {
      lines: [],
      shippingFee: 0,
      validUntil: '2099-01-01',
      basedOn: null,
    },
  });
  expect(quote.status()).toBe(403);
  await login(page, '山田');
  const accept = await page.request.post(`/api/orders/${id}/accept`, {
    data: { quoteId: '00000000-0000-4000-8000-000000000000' },
  });
  expect(accept.status()).toBe(403);
  // Cross-site posts are refused before anything runs.
  const forged = await page.request.post(`/api/orders/${id}/reject`, {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    data: { reason: 'x' },
  });
  expect(forged.status()).toBe(403);
});

test('a revision request goes back to headquarters', async ({ page }) => {
  await login(page, '鈴木');
  await page.getByRole('link', { name: /R-2026-0003/ }).click();
  await page.getByRole('button', { name: '修正を依頼する' }).click();
  await page
    .getByLabel('修正してほしい内容（本社に届きます）')
    .fill('ポリ袋は来月分と合わせて2箱にしてください。');
  await page.getByRole('button', { name: '修正を依頼する' }).click();
  await expect(page.locator('h1')).toContainText('本社の確認待ち');
  await expect(page.locator('.notice', { hasText: '修正依頼' })).toContainText(
    'ポリ袋は来月分と合わせて2箱',
  );
});

test('the admin re-imports the catalog from the supplier site', async ({
  page,
}) => {
  await login(page, '田中');
  await page.getByRole('link', { name: 'カタログ管理' }).click();
  await noA11yViolations(page);
  await page.getByRole('button', { name: 'サイトから取り込む' }).click();
  await expect(page.locator('.result-grid')).toContainText('変更なし 23');
  const site = await page.request.get('/demo-supplier/catalog.html');
  expect(site.status()).toBe(200);
  expect(await site.text()).toContain('"@type": "ItemList"');
});

test('the main screens pass accessibility checks in dark mode too', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page, '鈴木');
  await noA11yViolations(page);
  await page.goto('/catalog');
  await noA11yViolations(page);
  await page.getByRole('link', { name: '依頼一覧' }).click();
  await page.getByRole('link', { name: /R-2026-0003/ }).click();
  await noA11yViolations(page);
  // The theme switch overrides the system setting and is remembered.
  await page.getByRole('button', { name: 'ライト' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await noA11yViolations(page);
});
