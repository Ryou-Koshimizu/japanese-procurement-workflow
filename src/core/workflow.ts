// Statuses and who may do what, for screens and messages. The database
// enforces the same rules (app.order_guard, app.message_guard,
// app.maker_quote_guard, app.issue_quote, app.quote_guard) and is the authority.
//
// A社 (the client company, its branches = stores) asks B社 (the agency) for
// fixtures and supplies; B社 asks makers for quotes, adds expenses and profit,
// and orders once A社 agrees.

export type Role = 'client' | 'agent' | 'admin';
export type Status =
  | 'draft'
  | 'requested'
  | 'hearing'
  | 'sourcing'
  | 'quoted'
  | 'agreed'
  | 'ordered'
  | 'scheduled'
  | 'rejected'
  | 'cancelled';
export type QuoteStatus = 'sent' | 'superseded' | 'accepted' | 'declined';
export type MakerQuoteStatus =
  'requested' | 'received' | 'declined' | 'withdrawn';
export type MessageKind = 'question' | 'answer' | 'note';
export type DeliveryMode = 'direct' | 'via_agent';
export type PricingMode = 'markup' | 'price';
export type Stock = 'in_stock' | 'backorder' | 'out_of_stock';

export const roleLabels: Record<Role, string> = {
  client: 'A社 担当者',
  agent: 'B社 担当者',
  admin: 'B社 管理者',
};

export const statusLabels: Record<Status, string> = {
  draft: '下書き',
  requested: 'B社の確認待ち',
  hearing: 'A社の回答待ち',
  sourcing: 'メーカーに確認中',
  quoted: 'A社の合意待ち',
  agreed: 'B社の発注待ち',
  ordered: '納期の確認待ち',
  scheduled: '納期確定',
  rejected: 'お断り',
  cancelled: '取り下げ',
};

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  sent: '回答待ち',
  superseded: '新しい版で置き換え',
  accepted: '合意',
  declined: '修正依頼',
};

export const makerQuoteStatusLabels: Record<MakerQuoteStatus, string> = {
  requested: '回答待ち',
  received: '受け取り済み',
  declined: '辞退',
  withdrawn: '取り下げ',
};

export const deliveryModeLabels: Record<DeliveryMode, string> = {
  direct: 'メーカーから直送',
  via_agent: 'B社経由',
};

export const stockLabels: Record<Stock, string> = {
  in_stock: '在庫あり',
  backorder: '取り寄せ',
  out_of_stock: '在庫なし',
};

export const CLOSED_STATUSES: readonly Status[] = [
  'scheduled',
  'rejected',
  'cancelled',
];

export const isAgent = (role: Role) => role === 'agent' || role === 'admin';

/** Whose turn it is, used for the to-do counts and the list badges. */
export function waitingOn(status: Status): 'client' | 'agent' | null {
  switch (status) {
    case 'draft':
    case 'hearing':
    case 'quoted':
      return 'client';
    case 'requested':
    case 'sourcing':
    case 'agreed':
    case 'ordered':
      return 'agent';
    default:
      return null;
  }
}

export type Action =
  | 'answer'
  | 'ask'
  | 'note'
  | 'editOutline'
  | 'confirmOutline'
  | 'reopenOutline'
  | 'requestMakerQuote'
  | 'recordMakerQuote'
  | 'issueQuote'
  | 'accept'
  | 'revise'
  | 'placeOrder'
  | 'schedule'
  | 'reject'
  | 'cancel';

export function can(
  role: Role,
  status: Status,
  action: Action,
  { ownStore = false }: { ownStore?: boolean } = {},
): boolean {
  const agent = isAgent(role);
  const client = role === 'client' && ownStore;
  switch (action) {
    case 'answer':
      return client && status === 'hearing';
    case 'ask':
    case 'editOutline':
    case 'confirmOutline':
      return agent && status === 'requested';
    case 'note':
      return agent && status !== 'draft' && !CLOSED_STATUSES.includes(status);
    case 'reopenOutline':
    case 'requestMakerQuote':
      return agent && status === 'sourcing';
    case 'recordMakerQuote':
    case 'issueQuote':
      return agent && (status === 'sourcing' || status === 'quoted');
    case 'accept':
    case 'revise':
      return client && status === 'quoted';
    case 'placeOrder':
      return agent && status === 'agreed';
    case 'schedule':
      return agent && status === 'ordered';
    case 'reject':
      return (
        agent &&
        (status === 'requested' ||
          status === 'hearing' ||
          status === 'sourcing')
      );
    case 'cancel':
      return (
        client &&
        (status === 'requested' ||
          status === 'hearing' ||
          status === 'sourcing' ||
          status === 'quoted')
      );
  }
}

/** The steps shown on a request page. */
export const PROGRESS_STEPS = [
  '依頼',
  'ヒアリング',
  'メーカー確認',
  '見積書',
  '合意',
  '発注',
  '納期確定',
] as const;

/** Index in PROGRESS_STEPS of the stage a request is in; -1 once refused or withdrawn. */
export function progressIndex(status: Status): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'requested':
    case 'hearing':
      return 1;
    case 'sourcing':
      return 2;
    case 'quoted':
      return 3;
    case 'agreed':
      return 4;
    case 'ordered':
      return 5;
    case 'scheduled':
      return 6;
    default:
      return -1;
  }
}

export const MAX_QUOTE_DAYS = 180;
export const DEFAULT_QUOTE_DAYS = 14;
