// The public demo's fictional companies: B社 (an agency that buys fixtures and
// supplies for its client) and A社 (a café chain with three branches). After
// the accounts, everything goes through the same service functions the
// screens use, so every sample request reached its state through the real
// workflow, triggers and notifications.
import { hashPassword, type Session } from './auth';
import type { Role } from '../core/workflow';
import { DEFAULT_REQUEST_FIELDS } from '../core/intake';
import { DEMO_SUPPLIER } from '../demo/supplier-data';
import { addDays, todayInJapan } from './config';
import {
  acceptQuote,
  addNote,
  answerQuestion,
  askQuestion,
  confirmOutline,
  createMaker,
  createSource,
  getOrder,
  importFromSite,
  issueQuote,
  listCatalog,
  placeOrder,
  recordMakerQuote,
  rejectOrder,
  requestMakerQuotes,
  requestRevision,
  scheduleDelivery,
  setOutline,
  submitRequest,
  type Deps,
} from './service';
import { deliverOutbox } from './mailer';

/** Runs SQL as the database owner (setup only; requests never use it). */
export type OwnerSql = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

/** B社, the organization. */
export const DEMO_ORG = 'みどり購買サポート株式会社';
/** A社, B社's client. */
export const DEMO_CLIENT = '株式会社サンプルカフェ';
export const DEMO_PASSWORD = 'demo-password-2026';

export const demoStores = [
  { code: 'S01', name: '渋谷店', address: '東京都渋谷区〇〇 1-2-3（架空）' },
  {
    code: 'S02',
    name: '梅田店',
    address: '大阪府大阪市北区〇〇 4-5-6（架空）',
  },
  {
    code: 'S03',
    name: '博多店',
    address: '福岡県福岡市博多区〇〇 7-8-9（架空）',
  },
] as const;

export type DemoUser = {
  key: 'sato' | 'suzuki' | 'yamada' | 'tanaka';
  email: string;
  name: string;
  role: Role;
  store?: (typeof demoStores)[number]['code'];
};

export const demoUsers: DemoUser[] = [
  {
    key: 'sato',
    email: 'sato@sample-cafe.example.com',
    name: '佐藤 美咲',
    role: 'client',
    store: 'S01',
  },
  {
    key: 'suzuki',
    email: 'suzuki@sample-cafe.example.com',
    name: '鈴木 健',
    role: 'client',
    store: 'S02',
  },
  {
    key: 'yamada',
    email: 'yamada@midori-kobai.example.com',
    name: '山田 花子',
    role: 'agent',
  },
  {
    key: 'tanaka',
    email: 'tanaka@midori-kobai.example.com',
    name: '田中 誠',
    role: 'admin',
  },
];

export const demoMakers = {
  sakura: {
    name: 'さくら備品サプライ（架空）',
    contact_name: '木村',
    email: 'sakura-supply@example.com',
    phone: '03-0000-0001',
  },
  aoba: {
    name: 'あおば什器製作所（架空）',
    contact_name: '高橋',
    email: 'aoba-juki@example.com',
    phone: '06-0000-0002',
  },
  hikari: {
    name: 'ひかり家具工業（架空）',
    contact_name: '中村',
    email: 'hikari-kagu@example.com',
    phone: '092-000-0003',
  },
};

type Answers = Record<string, string | number>;

export async function seedDemo(owner: OwnerSql, deps: Deps) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const org = await owner.query<{ id: string }>(
    'INSERT INTO app.organizations (name, client_name, address) VALUES ($1, $2, $3) RETURNING id',
    [
      DEMO_ORG,
      DEMO_CLIENT,
      '東京都千代田区〇〇 9-9-9（架空） みどり購買サポート 受入倉庫',
    ],
  );
  const orgId = org.rows[0].id;
  const stores = new Map<string, { id: string; name: string }>();
  for (const st of demoStores) {
    const r = await owner.query<{ id: string }>(
      'INSERT INTO app.stores (org_id, code, name, address) VALUES ($1, $2, $3, $4) RETURNING id',
      [orgId, st.code, st.name, st.address],
    );
    stores.set(st.code, { id: r.rows[0].id, name: st.name });
  }
  const as = {} as Record<DemoUser['key'], Session>;
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
  for (const f of DEFAULT_REQUEST_FIELDS)
    await owner.query(
      `INSERT INTO app.request_fields (org_id, key, label, kind, required, options, help, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orgId,
        f.key,
        f.label,
        f.kind,
        f.required,
        f.options,
        f.help,
        f.position,
      ],
    );

  // B社's admin imports the catalog of さくら備品サプライ from its site.
  const sourceId = await createSource(deps, as.tanaka, {
    name: DEMO_SUPPLIER.name,
    kind: 'site',
    urls: [`${DEMO_SUPPLIER.origin}${DEMO_SUPPLIER.catalogPath}`],
    pricesIncludeTax: true,
    defaultTaxRate: 10,
  });
  await importFromSite(deps, as.tanaka, sourceId);
  const { items } = await listCatalog(deps, as.tanaka);
  const item = (sku: string) => {
    const found = items.find((i) => i.sku === sku);
    if (!found) throw new Error(`demo item ${sku} missing after import`);
    return found;
  };

  const makers = {
    sakura: await createMaker(deps, as.yamada, {
      ...demoMakers.sakura,
      note: '消耗品・小物の定番。カタログはサイトから取り込み済み。',
      catalog_source_id: sourceId,
    }),
    aoba: await createMaker(deps, as.yamada, {
      ...demoMakers.aoba,
      note: 'カウンター・棚など造作什器。現場採寸に対応。',
    }),
    hikari: await createMaker(deps, as.yamada, {
      ...demoMakers.hikari,
      note: '椅子・テーブル。まとめ買いの値引きあり。',
    }),
  };

  const today = todayInJapan();
  const request = (
    who: Session,
    title: string,
    answers: Answers,
    extra: { needed_by?: string; note?: string } = {},
  ) =>
    submitRequest(deps, who, {
      title,
      answers: Object.entries(answers).map(([key, value]) => ({ key, value })),
      ...extra,
    });
  type Line = {
    name: string;
    spec?: string;
    qty: number;
    unit?: string;
    tax_rate?: 8 | 10;
    item_id?: string;
  };
  /** B社 writes the outline and fixes it; returns the outline line ids. */
  const outline = async (orderId: string, lines: Line[]) => {
    await setOutline(deps, as.yamada, orderId, lines);
    await confirmOutline(deps, as.yamada, orderId);
    return (await getOrder(deps, as.yamada, orderId)).lines.map((l) => l.id);
  };
  /** Ask makers; returns maker quote ids by maker key. */
  const ask = async (orderId: string, keys: (keyof typeof makers)[]) => {
    const ids = await requestMakerQuotes(
      deps,
      as.yamada,
      orderId,
      keys.map((k) => makers[k]),
    );
    return Object.fromEntries(keys.map((k, i) => [k, ids[i]])) as Record<
      keyof typeof makers,
      string
    >;
  };
  const record = (
    makerQuoteId: string,
    lineIds: string[],
    costs: number[],
    extra: {
      shipping_cost?: number;
      lead_time?: string;
      stock?: 'in_stock' | 'backorder' | 'out_of_stock';
      note?: string;
    } = {},
  ) =>
    recordMakerQuote(deps, as.yamada, makerQuoteId, {
      lines: lineIds.map((id, i) => ({
        order_line_id: id,
        unit_cost: costs[i],
        stock: extra.stock ?? 'in_stock',
      })),
      shipping_cost: extra.shipping_cost ?? 0,
      lead_time: extra.lead_time ?? '受注後10日',
      valid_until: addDays(today, 30),
      note: extra.note ?? null,
    });
  const quoteId = async (who: Session, orderId: string) =>
    (await getOrder(deps, who, orderId)).current_quote_id!;

  // 1. 渋谷店: the whole flow, up to the delivery notice.
  const counter = await request(
    as.sato,
    '受付カウンターの入れ替え',
    {
      item: '受付カウンター',
      purpose: '天板が割れて、レジが傾くようになった',
      place: '1階 入口の右側',
      size: '幅180×奥行60×高さ100（cm）まで',
      quantity: 1,
      delivery: '1階、搬入口の幅90cm。開店前（8時まで）に搬入したい',
    },
    { needed_by: addDays(today, 30), note: '営業中の工事は避けたいです。' },
  );
  await askQuestion(
    deps,
    as.yamada,
    counter,
    '今のカウンターの色と、レジを置く棚が要るかを教えてください。',
  );
  await answerQuestion(
    deps,
    as.sato,
    counter,
    '白木調でお願いします。レジ下に棚が1段ほしいです。',
  );
  await addNote(
    deps,
    as.yamada,
    counter,
    '電話で確認：古いカウンターの引き取りも希望。搬入は平日8時まで。',
  );
  const counterLines = await outline(counter, [
    {
      name: '受付カウンター',
      spec: '白木調 W1800×D600×H1000 レジ下棚1段',
      qty: 1,
      unit: '台',
    },
    { name: '設置・古いカウンターの引き取り', qty: 1, unit: '式' },
  ]);
  const counterMq = await ask(counter, ['aoba', 'hikari']);
  await record(counterMq.aoba, counterLines, [168_000, 25_000], {
    shipping_cost: 12_000,
    lead_time: '受注後14日',
  });
  await record(counterMq.hikari, counterLines, [182_000, 20_000], {
    shipping_cost: 8_000,
    lead_time: '受注後21日',
    stock: 'backorder',
  });
  await issueQuote(deps, as.yamada, counter, {
    maker_quote_id: counterMq.aoba,
    mode: 'markup',
    markup_bp: 2000,
    shipping_fee: 15_000,
    expenses: 10_000,
    valid_until: addDays(today, 14),
    note: '設置と古いカウンターの引き取りを含みます。',
  });
  await acceptQuote(deps, as.sato, counter, await quoteId(as.sato, counter));
  await placeOrder(deps, as.yamada, counter, {
    delivery_mode: 'direct',
    delivery_note: '平日8時までに搬入。古いカウンターを引き取り。',
  });
  await scheduleDelivery(deps, as.yamada, counter, {
    delivery_date: addDays(today, 18),
  });

  // 2. 梅田店: agreed, waiting for B社 to order.
  const shelf = await request(
    as.suzuki,
    '休憩室の収納棚',
    {
      item: '収納棚',
      purpose: 'スタッフの荷物が床に置かれていて危ない',
      place: '2階 休憩室の壁ぎわ',
      quantity: 2,
      budget: 60_000,
    },
    { needed_by: addDays(today, 21) },
  );
  const shelfLines = await outline(shelf, [
    { name: 'スチール収納棚', spec: '5段 W900×D450×H1800', qty: 2, unit: '台' },
  ]);
  const shelfMq = await ask(shelf, ['aoba']);
  await record(shelfMq.aoba, shelfLines, [19_800], { shipping_cost: 3_000 });
  await issueQuote(deps, as.yamada, shelf, {
    maker_quote_id: shelfMq.aoba,
    mode: 'price',
    prices: [{ order_line_id: shelfLines[0], unit_price: 24_800 }],
    shipping_fee: 3_000,
    expenses: 0,
    valid_until: addDays(today, 14),
  });
  await acceptQuote(deps, as.suzuki, shelf, await quoteId(as.suzuki, shelf));

  // 3. 渋谷店: a revision was asked for; the second quote waits for 渋谷店.
  const supplies = await request(
    as.sato,
    'レジ回りの消耗品（月初の補充）',
    {
      item: 'レシートロール、紙ナプキン、手指消毒用アルコール',
      purpose: '月初の補充。在庫が残り少ない',
      place: 'バックヤード',
      quantity: 13,
    },
    { needed_by: addDays(today, 10) },
  );
  const sku = (code: string, qty: number) => {
    const i = item(code);
    return {
      name: i.name,
      qty,
      unit: i.unit,
      tax_rate: i.tax_rate,
      item_id: i.id,
    };
  };
  const supplyLines = await outline(supplies, [
    sku('SK-1001', 4),
    sku('SK-1002', 6),
    sku('SK-2002', 3),
  ]);
  const supplyMq = await ask(supplies, ['sakura']);
  await record(
    supplyMq.sakura,
    supplyLines,
    ['SK-1001', 'SK-1002', 'SK-2002'].map((c) =>
      Math.round(item(c).unit_price * 0.75),
    ),
    { lead_time: '受注後3日' },
  );
  await issueQuote(deps, as.yamada, supplies, {
    maker_quote_id: supplyMq.sakura,
    mode: 'markup',
    markup_bp: 2000,
    shipping_fee: 880,
    expenses: 0,
    valid_until: addDays(today, 14),
  });
  await requestRevision(
    deps,
    as.sato,
    supplies,
    await quoteId(as.sato, supplies),
    '先月より高いようです。送料なしにできませんか。',
  );
  await issueQuote(deps, as.yamada, supplies, {
    maker_quote_id: supplyMq.sakura,
    mode: 'markup',
    markup_bp: 1500,
    shipping_fee: 0,
    expenses: 0,
    valid_until: addDays(today, 14),
    note: '利益を見直し、送料はB社の定期便に載せて無料にしました。',
  });

  // 4. 梅田店: two makers answered, one has not yet (相見積).
  const chairs = await request(
    as.suzuki,
    '客席の椅子の追加',
    {
      item: 'カフェチェア',
      purpose: '席を12席ふやす',
      place: '1階 客席',
      quantity: 12,
      current_model: 'CC-200（今の椅子）',
      budget: 150_000,
    },
    { needed_by: addDays(today, 45) },
  );
  const chairLines = await outline(chairs, [
    {
      name: 'カフェチェア',
      spec: '木製 座面ファブリック グレー 今の椅子CC-200に近い物',
      qty: 12,
      unit: '脚',
    },
  ]);
  const chairMq = await ask(chairs, ['hikari', 'aoba', 'sakura']);
  await record(chairMq.hikari, chairLines, [8_900], {
    shipping_cost: 6_000,
    lead_time: '受注後20日',
    stock: 'backorder',
  });
  await record(chairMq.aoba, chairLines, [9_800], {
    shipping_cost: 4_000,
    lead_time: '受注後7日',
  });

  // 5. 渋谷店: B社 asked a question; waiting for 渋谷店's answer.
  const stand = await request(as.sato, '店頭のメニュースタンド', {
    item: 'メニュースタンド（A型看板）',
    purpose: '今の看板が色あせて読みにくい',
    place: '店の前の歩道ぎわ',
    quantity: 1,
  });
  await askQuestion(
    deps,
    as.yamada,
    stand,
    '屋外に出しっぱなしにしますか？ 風で倒れない重さが必要かも教えてください。',
  );

  // 6. 梅田店: a new request B社 has not looked at yet.
  await request(
    as.suzuki,
    '入口の傘立て',
    {
      item: '傘立て',
      purpose: '雨の日に入口が濡れて滑りやすい',
      place: '1階 入口の内側',
      size: '幅60×奥行30（cm）まで',
      quantity: 1,
      reference_url: 'https://example.com/umbrella-stand',
    },
    { needed_by: addDays(today, 14) },
  );

  // 7. 渋谷店: refused with a reason.
  const fridge = await request(as.sato, '業務用冷蔵庫の買い替え', {
    item: '業務用冷蔵庫',
    purpose: '冷えが悪くなった',
    place: '厨房',
    quantity: 1,
  });
  await rejectOrder(
    deps,
    as.yamada,
    fridge,
    '冷蔵庫は修理で直る場合があります。先にA社の設備担当から修理業者に見てもらってください。',
  );

  await deliverOutbox(deps.db, deps.mail, deps.origin, 500);
}
