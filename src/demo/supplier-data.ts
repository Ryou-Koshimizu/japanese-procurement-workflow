// The fictional supplier of the public demo. scripts/build-demo-supplier.ts
// turns this into a small static shop site under public/demo-supplier/, with
// the same kind of structured product data (schema.org JSON-LD) real shops
// publish, and the demo imports the catalog from that site with the same
// parser it uses for real ones. Companies, brands and products are fictional.

export const DEMO_SUPPLIER = {
  name: 'さくら備品サプライ（架空）',
  /** Reserved example domain: the demo never connects to it. */
  origin: 'https://sakura-supply.example',
  catalogPath: '/catalog.html',
  /** Where the app serves the same site for people to look at. */
  localPath: '/demo-supplier',
};

export type Art =
  | 'ream'
  | 'pump'
  | 'pouch'
  | 'roll'
  | 'bags'
  | 'pens'
  | 'battery'
  | 'case'
  | 'bulb'
  | 'mop'
  | 'broom'
  | 'tissue-box'
  | 'towels'
  | 'wrap'
  | 'files'
  | 'tape'
  | 'drip'
  | 'spray'
  | 'paper-bag'
  | 'markers';

export type DemoProduct = {
  sku: string;
  name: string;
  brand: string;
  category: string;
  /** Price as the site lists it, tax included. */
  price: number;
  /** For the seed: 8 for food and drink (reduced rate). */
  taxRate: 8 | 10;
  unit: string;
  description: string;
  inStock: boolean;
  art: Art;
  /** Main and accent colors of the drawing. */
  color: string;
  accent: string;
};

export const CATEGORIES = [
  { slug: 'shop', name: '店舗消耗品', tint: '#fbf3e6' },
  { slug: 'hygiene', name: '衛生用品', tint: '#e8f5f3' },
  { slug: 'office', name: '事務用品', tint: '#eaf1fb' },
  { slug: 'cleaning', name: '清掃・設備', tint: '#eef5e9' },
  { slug: 'drinks', name: '来客用飲料', tint: '#f3f1e7' },
] as const;

const c = (slug: (typeof CATEGORIES)[number]['slug']) =>
  CATEGORIES.find((x) => x.slug === slug)!.name;

export const PRODUCTS: DemoProduct[] = [
  {
    sku: 'SK-1001',
    name: 'レシートロール 感熱紙 58mm幅 20巻',
    brand: 'さくらセレクト',
    category: c('shop'),
    price: 2178,
    taxRate: 10,
    unit: 'パック',
    description: 'レジ用の感熱ロール紙。外径65mm・芯内径12mm。',
    inStock: true,
    art: 'roll',
    color: '#f8fafc',
    accent: '#e0a43a',
  },
  {
    sku: 'SK-1002',
    name: '紙ナプキン 2枚重ね 1000枚入',
    brand: 'さくらセレクト',
    category: c('shop'),
    price: 1078,
    taxRate: 10,
    unit: 'パック',
    description: '6つ折りのテーブル用ナプキン。',
    inStock: true,
    art: 'tissue-box',
    color: '#fdf6ec',
    accent: '#d9822b',
  },
  {
    sku: 'SK-1003',
    name: 'テイクアウト用 紙袋 Mサイズ 100枚',
    brand: 'こはく包装',
    category: c('shop'),
    price: 2640,
    taxRate: 10,
    unit: '束',
    description: '角底の手提げなし紙袋。幅21×マチ12×高さ27cm。',
    inStock: true,
    art: 'paper-bag',
    color: '#c99a62',
    accent: '#a87943',
  },
  {
    sku: 'SK-1004',
    name: 'ポリ袋 45L 半透明 50枚×10冊',
    brand: 'こはく包装',
    category: c('shop'),
    price: 3520,
    taxRate: 10,
    unit: '箱',
    description: '厚さ0.025mmのごみ袋。店舗の分別用に。',
    inStock: true,
    art: 'bags',
    color: '#dbe4ea',
    accent: '#7a93a6',
  },
  {
    sku: 'SK-1005',
    name: '業務用ラップ 30cm×100m',
    brand: 'こはく包装',
    category: c('shop'),
    price: 1298,
    taxRate: 10,
    unit: '本',
    description: '刃付きの箱入り。仕込みや保管に。',
    inStock: true,
    art: 'wrap',
    color: '#2f6f9f',
    accent: '#cfe3f1',
  },
  {
    sku: 'SK-2001',
    name: 'ハンドソープ 泡タイプ 詰替用 2L',
    brand: 'あおば衛材',
    category: c('hygiene'),
    price: 1958,
    taxRate: 10,
    unit: '袋',
    description: '泡で出るポンプ用の詰め替え。無香料。',
    inStock: true,
    art: 'pouch',
    color: '#4fb3a9',
    accent: '#e6f6f4',
  },
  {
    sku: 'SK-2002',
    name: '手指消毒用アルコール 1L ポンプ付',
    brand: 'あおば衛材',
    category: c('hygiene'),
    price: 1650,
    taxRate: 10,
    unit: '本',
    description: '入口・レジ横用のポンプボトル。',
    inStock: true,
    art: 'pump',
    color: '#eaf6fb',
    accent: '#2a8fbf',
  },
  {
    sku: 'SK-2003',
    name: 'ニトリル手袋 パウダーフリー Mサイズ 100枚',
    brand: 'あおば衛材',
    category: c('hygiene'),
    price: 968,
    taxRate: 10,
    unit: '箱',
    description: '調理・清掃兼用の使い捨て手袋。',
    inStock: true,
    art: 'tissue-box',
    color: '#5b7fd6',
    accent: '#dfe7fb',
  },
  {
    sku: 'SK-2004',
    name: 'ペーパータオル 中判 200枚×30パック',
    brand: 'あおば衛材',
    category: c('hygiene'),
    price: 4290,
    taxRate: 10,
    unit: 'ケース',
    description: '洗面所のホルダー用。再生紙100%。',
    inStock: false,
    art: 'case',
    color: '#c7a77b',
    accent: '#f5efe4',
  },
  {
    sku: 'SK-2005',
    name: '除菌ウェットシート 80枚×3個',
    brand: 'あおば衛材',
    category: c('hygiene'),
    price: 858,
    taxRate: 10,
    unit: 'セット',
    description: 'テーブル・ドアノブの拭き取りに。',
    inStock: true,
    art: 'towels',
    color: '#8fd0c4',
    accent: '#ffffff',
  },
  {
    sku: 'SK-3001',
    name: 'コピー用紙 A4 500枚×5冊',
    brand: 'ことり文具',
    category: c('office'),
    price: 2398,
    taxRate: 10,
    unit: '箱',
    description: '白色度約93%。シフト表や掲示物の印刷に。',
    inStock: true,
    art: 'ream',
    color: '#ffffff',
    accent: '#3b82c4',
  },
  {
    sku: 'SK-3002',
    name: '油性ボールペン 0.7mm 黒 10本',
    brand: 'ことり文具',
    category: c('office'),
    price: 660,
    taxRate: 10,
    unit: '箱',
    description: 'ノック式。レジ・受付用。',
    inStock: true,
    art: 'pens',
    color: '#2b3442',
    accent: '#9aa8bb',
  },
  {
    sku: 'SK-3003',
    name: '油性マーカー 太字・細字 10本',
    brand: 'ことり文具',
    category: c('office'),
    price: 1320,
    taxRate: 10,
    unit: '箱',
    description: '段ボールやPOPの手書きに。',
    inStock: true,
    art: 'markers',
    color: '#e5484d',
    accent: '#2b3442',
  },
  {
    sku: 'SK-3004',
    name: 'アルカリ乾電池 単3形 20本',
    brand: 'ことり文具',
    category: c('office'),
    price: 1078,
    taxRate: 10,
    unit: 'パック',
    description: 'リモコン・ハンディ端末の予備に。',
    inStock: true,
    art: 'battery',
    color: '#d9a21b',
    accent: '#2b3442',
  },
  {
    sku: 'SK-3005',
    name: 'クリアファイル A4 100枚',
    brand: 'ことり文具',
    category: c('office'),
    price: 1100,
    taxRate: 10,
    unit: 'パック',
    description: '書類の受け渡し・保管に。',
    inStock: true,
    art: 'files',
    color: '#a9d2f2',
    accent: '#5aa4dc',
  },
  {
    sku: 'SK-3006',
    name: '布粘着テープ 50mm×25m 5巻',
    brand: 'ことり文具',
    category: c('office'),
    price: 1485,
    taxRate: 10,
    unit: 'パック',
    description: '手で切れる梱包用テープ。',
    inStock: true,
    art: 'tape',
    color: '#c8a06a',
    accent: '#8c6a3c',
  },
  {
    sku: 'SK-4001',
    name: '業務用モップ 替え糸付き',
    brand: 'みどり清掃',
    category: c('cleaning'),
    price: 3080,
    taxRate: 10,
    unit: '本',
    description: '床の水拭き用。柄の長さ120cm。',
    inStock: true,
    art: 'mop',
    color: '#5c9e5a',
    accent: '#e9efe6',
  },
  {
    sku: 'SK-4002',
    name: 'ほうき・ちりとりセット',
    brand: 'みどり清掃',
    category: c('cleaning'),
    price: 2178,
    taxRate: 10,
    unit: 'セット',
    description: '店頭・バックヤード用。',
    inStock: true,
    art: 'broom',
    color: '#5c9e5a',
    accent: '#d6b46b',
  },
  {
    sku: 'SK-4003',
    name: '食器用洗剤 業務用 4L',
    brand: 'みどり清掃',
    category: c('cleaning'),
    price: 1738,
    taxRate: 10,
    unit: '本',
    description: '中性。食器・調理器具用。',
    inStock: true,
    art: 'spray',
    color: '#7ec46f',
    accent: '#f4fbf2',
  },
  {
    sku: 'SK-4004',
    name: 'LED電球 60W形相当 昼白色 4個',
    brand: 'みどり清掃',
    category: c('cleaning'),
    price: 2970,
    taxRate: 10,
    unit: 'パック',
    description: 'E26口金。店内照明の交換用。',
    inStock: true,
    art: 'bulb',
    color: '#ffe58f',
    accent: '#b8c0cc',
  },
  {
    sku: 'SK-5001',
    name: '緑茶 ペットボトル 525ml×24本',
    brand: 'みなと飲料',
    category: c('drinks'),
    price: 2808,
    taxRate: 8,
    unit: 'ケース',
    description: '来客・会議用。軽減税率（8%）対象。',
    inStock: true,
    art: 'case',
    color: '#5b8f3d',
    accent: '#e5efd9',
  },
  {
    sku: 'SK-5002',
    name: 'ミネラルウォーター 500ml×24本',
    brand: 'みなと飲料',
    category: c('drinks'),
    price: 1944,
    taxRate: 8,
    unit: 'ケース',
    description: '国内の天然水（軟水）。軽減税率（8%）対象。',
    inStock: true,
    art: 'case',
    color: '#3a8fd1',
    accent: '#e3f0fa',
  },
  {
    sku: 'SK-5003',
    name: 'ドリップコーヒー 7g×100袋',
    brand: 'みなと飲料',
    category: c('drinks'),
    price: 3240,
    taxRate: 8,
    unit: '箱',
    description: '中深煎りのブレンド。来客用。軽減税率（8%）対象。',
    inStock: true,
    art: 'drip',
    color: '#7a4b2c',
    accent: '#f1e6da',
  },
];
