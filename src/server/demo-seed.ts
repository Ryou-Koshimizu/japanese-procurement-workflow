// The public demo's fictional company. Everything after the accounts goes
// through the same service functions the screens use, so every sample order
// reached its state through the real workflow, triggers and notifications.
import { hashPassword, type Session } from './auth';
import type { Role } from '../core/workflow';
import { DEMO_SUPPLIER } from '../demo/supplier-data';
import { addDays, todayInJapan } from './config';
import {
  addToCart,
  acceptQuote,
  createSource,
  getOrder,
  importFromSite,
  issueQuote,
  listCatalog,
  rejectOrder,
  requestRevision,
  submitCart,
  updateItem,
  type Deps,
} from './service';
import { deliverOutbox } from './mailer';

/** Runs SQL as the database owner (setup only; requests never use it). */
export type OwnerSql = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export const DEMO_ORG = '株式会社サンプルカフェ';
export const DEMO_PASSWORD = 'demo-password-2026';

export const demoStores = [
  { code: 'S01', name: '渋谷店' },
  { code: 'S02', name: '横浜店' },
  { code: 'S03', name: '大宮店' },
] as const;

export type DemoUser = {
  key: string;
  email: string;
  name: string;
  role: Role;
  store?: (typeof demoStores)[number]['code'];
};

export const demoUsers: DemoUser[] = [
  {
    key: 'shibuya',
    email: 'sato@sample-cafe.example',
    name: '佐藤 美咲',
    role: 'store',
    store: 'S01',
  },
  {
    key: 'yokohama',
    email: 'suzuki@sample-cafe.example',
    name: '鈴木 健',
    role: 'store',
    store: 'S02',
  },
  {
    key: 'omiya',
    email: 'ito@sample-cafe.example',
    name: '伊藤 さくら',
    role: 'store',
    store: 'S03',
  },
  {
    key: 'buyer',
    email: 'yamada@sample-cafe.example',
    name: '山田 花子',
    role: 'buyer',
  },
  {
    key: 'admin',
    email: 'tanaka@sample-cafe.example',
    name: '田中 誠',
    role: 'admin',
  },
];

export async function seedDemo(owner: OwnerSql, deps: Deps) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const org = await owner.query<{ id: string }>(
    'INSERT INTO app.organizations (name) VALUES ($1) RETURNING id',
    [DEMO_ORG],
  );
  const orgId = org.rows[0].id;
  const stores = new Map<string, { id: string; name: string }>();
  for (const st of demoStores) {
    const r = await owner.query<{ id: string }>(
      'INSERT INTO app.stores (org_id, code, name) VALUES ($1, $2, $3) RETURNING id',
      [orgId, st.code, st.name],
    );
    stores.set(st.code, { id: r.rows[0].id, name: st.name });
  }
  const as: Record<string, Session> = {};
  for (const u of demoUsers) {
    const r = await owner.query<{ id: string }>(
      'INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [u.email, u.name, hash],
    );
    const store = u.store ? stores.get(u.store)! : null;
    await owner.query(
      'INSERT INTO app.memberships (org_id, user_id, role, store_id) VALUES ($1, $2, $3, $4)',
      [orgId, r.rows[0].id, u.role, store?.id ?? null],
    );
    as[u.key] = {
      userId: r.rows[0].id,
      orgId,
      role: u.role,
      storeId: store?.id ?? null,
      storeName: store?.name ?? null,
      userName: u.name,
      email: u.email,
      orgName: DEMO_ORG,
    };
  }

  // Headquarters registers the supplier's site and imports its catalog.
  const sourceId = await createSource(deps, as.admin, {
    name: DEMO_SUPPLIER.name,
    kind: 'site',
    urls: [`${DEMO_SUPPLIER.origin}${DEMO_SUPPLIER.catalogPath}`],
    pricesIncludeTax: true,
    defaultTaxRate: 10,
    orderEmail: 'orders@sakura-supply.example',
  });
  await importFromSite(deps, as.admin, sourceId);
  const { items } = await listCatalog(deps, as.admin);
  const item = (sku: string) => {
    const found = items.find((i) => i.sku === sku);
    if (!found) throw new Error(`demo item ${sku} missing after import`);
    return found.id;
  };
  // Headquarters stops listing one item for the stores.
  await updateItem(deps, as.admin, item('SK-4004'), { active: false });

  const today = todayInJapan();
  const request = async (
    who: Session,
    lines: [string, number][],
    extra: { neededBy?: string; note?: string } = {},
  ) => {
    let orderId = '';
    for (const [sku, n] of lines)
      orderId = (await addToCart(deps, who, item(sku), n)).orderId;
    await submitCart(deps, who, orderId, extra);
    return orderId;
  };
  const quote = async (
    orderId: string,
    prices: Record<string, number> = {},
    shippingFee = 0,
    note?: string,
    drop: string[] = [],
  ) => {
    const order = await getOrder(deps, as.buyer, orderId);
    return issueQuote(deps, as.buyer, orderId, {
      lines: order.lines
        .filter((l) => !drop.includes(l.sku ?? ''))
        .map((l) => ({
          orderLineId: l.id,
          unitPrice: prices[l.sku ?? ''] ?? l.unit_price,
          qty: l.qty,
        })),
      shippingFee,
      validUntil: addDays(today, 14),
      note: note ?? null,
      basedOn: order.quote_version ?? order.quotes[0]?.version ?? null,
    });
  };
  const currentQuoteId = async (who: Session, orderId: string) =>
    (await getOrder(deps, who, orderId)).current_quote_id!;

  // 1. Shibuya: the whole flow, ordered.
  const done = await request(
    as.shibuya,
    [
      ['SK-1001', 2],
      ['SK-2001', 3],
      ['SK-5001', 2],
      ['SK-3001', 1],
    ],
    {
      neededBy: addDays(today, 7),
      note: 'レシートロールの在庫が残り3巻です。',
    },
  );
  await quote(
    done,
    { 'SK-2001': 1700 },
    0,
    '詰替用は本社の年間契約価格で手配します。',
  );
  await acceptQuote(
    deps,
    as.shibuya,
    done,
    await currentQuoteId(as.shibuya, done),
  );

  // 2. Omiya: rejected with a reason.
  const rejected = await request(as.omiya, [['SK-4001', 2]], {
    note: 'モップが2本とも傷んでいます。',
  });
  await rejectOrder(
    deps,
    as.buyer,
    rejected,
    '来週、本社の在庫から渋谷店と合わせて配送します。',
  );

  // 3. Yokohama: a revision was asked for, the second quote waits for the store.
  const revised = await request(
    as.yokohama,
    [
      ['SK-1003', 3],
      ['SK-1004', 1],
      ['SK-2003', 4],
    ],
    {
      neededBy: addDays(today, 10),
    },
  );
  await quote(revised, {}, 880);
  await requestRevision(
    deps,
    as.yokohama,
    revised,
    await currentQuoteId(as.yokohama, revised),
    '紙袋は2束で足ります。送料がかからない方法があれば教えてください。',
  );
  const order3 = await getOrder(deps, as.buyer, revised);
  await issueQuote(deps, as.buyer, revised, {
    lines: order3.lines.map((l) => ({
      orderLineId: l.id,
      unitPrice: l.unit_price,
      qty: l.sku === 'SK-1003' ? 2 : l.qty,
    })),
    shippingFee: 0,
    validUntil: addDays(today, 14),
    note: '紙袋を2束にしました。本社便に載せるため送料はかかりません。',
    basedOn: order3.quotes[0].version,
  });

  // 4. Shibuya: a fresh request waiting for headquarters.
  await request(
    as.shibuya,
    [
      ['SK-3004', 2],
      ['SK-2002', 2],
      ['SK-5003', 1],
    ],
    {
      neededBy: addDays(today, 5),
      note: '来週の店長会議の来客用です。',
    },
  );

  await deliverOutbox(deps.db, deps.mail, deps.origin, 500);
}
