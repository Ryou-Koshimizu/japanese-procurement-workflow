// Statuses and who may do what, for screens and messages. The database
// enforces the same rules (app.order_guard, app.quote_guard) and is the
// authority.

export type Role = 'store' | 'buyer' | 'admin';
export type Status =
  'draft' | 'requested' | 'quoted' | 'ordered' | 'rejected' | 'cancelled';
export type QuoteStatus = 'sent' | 'superseded' | 'accepted' | 'declined';

export const roleLabels: Record<Role, string> = {
  store: '店舗スタッフ',
  buyer: '本社 購買担当',
  admin: '本社 管理者',
};

export const statusLabels: Record<Status, string> = {
  draft: '下書き',
  requested: '本社の確認待ち',
  quoted: '店舗の承諾待ち',
  ordered: '発注済み',
  rejected: '却下',
  cancelled: '取り下げ',
};

export const quoteStatusLabels: Record<QuoteStatus, string> = {
  sent: '回答待ち',
  superseded: '再見積で置き換え',
  accepted: '承諾',
  declined: '修正依頼',
};

export const isHq = (role: Role) => role === 'buyer' || role === 'admin';

/** Whose turn it is, used for the to-do counts and the list badges. */
export function waitingOn(status: Status): 'store' | 'hq' | null {
  if (status === 'requested') return 'hq';
  if (status === 'quoted') return 'store';
  return null;
}

export type Action = 'quote' | 'reject' | 'accept' | 'revise' | 'cancel';

export function can(
  role: Role,
  status: Status,
  action: Action,
  { ownStore = false }: { ownStore?: boolean } = {},
): boolean {
  switch (action) {
    case 'quote':
      return isHq(role) && (status === 'requested' || status === 'quoted');
    case 'reject':
      return isHq(role) && status === 'requested';
    case 'accept':
    case 'revise':
      return role === 'store' && ownStore && status === 'quoted';
    case 'cancel':
      return (
        role === 'store' &&
        ownStore &&
        (status === 'requested' || status === 'quoted')
      );
  }
}

export const MAX_QUOTE_DAYS = 180;
export const DEFAULT_QUOTE_DAYS = 14;
