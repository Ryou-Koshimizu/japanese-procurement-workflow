import { yen } from '../core/money';
import type { AuditEntry } from '../server/service';

/** The audit trail in words. Entries that repeat another one return null. */
export function auditText(a: AuditEntry): string | null {
  const d = a.detail as Record<string, string | number | boolean | undefined>;
  switch (a.action) {
    case 'status:requested':
      return d.from === 'quoted'
        ? null
        : `店舗が発注を依頼（${d.request_number}）`;
    case 'quote:issued':
      return `本社が承認し、見積 第${d.version}版を送付（${yen(d.total as number)}・期限 ${String(d.valid_until).slice(5).replace('-', '/')}）`;
    case 'quote:accepted':
      return `店舗が見積 第${d.version}版を承諾`;
    case 'quote:declined':
      return `店舗が見積 第${d.version}版の修正を依頼：${d.note ?? ''}`;
    case 'status:ordered':
      return `発注確定 ${d.po_number}（${yen(d.total as number)}）・店舗と本社と仕入先へ金額を通知`;
    case 'status:rejected':
      return `本社が却下：${d.reason ?? ''}`;
    case 'status:cancelled':
      return `店舗が取り下げ${d.reason ? `：${d.reason}` : ''}`;
    case 'status:quoted':
    case 'quote:revised':
      return null;
    case 'catalog:source':
      return `仕入先を登録：${d.source}`;
    case 'catalog:source-edit':
      return `仕入先の設定を変更：${d.source}`;
    case 'catalog:import':
      return `カタログを取り込み：${d.source}（読み取り ${d.found}件・新規 ${d.created}・変更 ${d.updated}・掲載なし ${d.missing}）`;
    case 'catalog:item': {
      const parts = [];
      if (d.active !== undefined)
        parts.push(d.active ? '店舗に表示' : '店舗に非表示');
      if (d.tax_rate !== undefined) parts.push(`税率 ${d.tax_rate}%`);
      if (d.unit !== undefined) parts.push(`単位 ${d.unit}`);
      return `商品を編集：${d.item}（${parts.join('・')}）`;
    }
    default:
      return a.action;
  }
}
