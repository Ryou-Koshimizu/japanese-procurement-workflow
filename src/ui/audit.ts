import { yen } from '../core/money';
import type { AuditEntry } from '../server/service';

const statusText: Record<string, string> = {
  hearing: 'B社が質問し、A社の回答待ちに',
  sourcing: 'B社が商品概要を確定し、メーカーに確認中に',
  agreed: 'A社が見積書に合意',
};

/** The audit trail in words. Entries that repeat another one return null. */
export function auditText(a: AuditEntry): string | null {
  const d = a.detail as Record<string, string | number | boolean | undefined>;
  switch (a.action) {
    case 'status:requested':
      if (d.from === 'draft') return `A社が依頼を送信（${d.request_number}）`;
      if (d.from === 'hearing') return null; // the answer says it
      if (d.from === 'sourcing') return 'B社が商品概要を直すため確認に戻した';
      return null;
    case 'status:hearing':
    case 'status:quoted':
    case 'quote:revised':
      return null;
    case 'status:sourcing':
      return d.from === 'quoted' ? null : statusText.sourcing;
    case 'status:agreed':
      return `A社が合意（合計 ${yen(d.total as number)}・税込）`;
    case 'message:question':
      return 'B社が質問を送信';
    case 'message:answer':
      return 'A社が質問に回答';
    case 'message:note':
      return 'B社がメモを追加（B社だけに見えます）';
    case 'maker_quote:requested':
      return 'B社がメーカーに見積を依頼';
    case 'maker_quote:received':
      return 'メーカーの見積を記録';
    case 'maker_quote:declined':
      return 'メーカーの見積を辞退として記録';
    case 'maker_quote:withdrawn':
      return 'メーカーへの見積依頼を取り下げ';
    case 'quote:pricing':
      return `見積書の値決め（${d.pricing_mode === 'markup' ? '利益率' : '売値を入力'}）`;
    case 'quote:issued':
      return `B社が見積書 第${d.version}版を送付（${yen(d.total as number)}・期限 ${String(d.valid_until).slice(5).replace('-', '/')}）`;
    case 'quote:accepted':
      return null; // status:agreed says it with the amount
    case 'quote:declined':
      return `A社が見積書 第${d.version}版の修正を依頼：${d.note ?? ''}`;
    case 'status:ordered':
      return `B社がメーカーに発注 ${d.po_number}（${d.delivery_mode === 'via_agent' ? 'B社経由' : 'メーカーから直送'}）`;
    case 'status:scheduled':
      return `納期を確定（${String(d.delivery_date).slice(5).replace('-', '/')}）・A社にお知らせを送信`;
    case 'status:rejected':
      return `B社がお断り：${d.reason ?? ''}`;
    case 'status:cancelled':
      return `A社が取り下げ${d.reason ? `：${d.reason}` : ''}`;
    case 'catalog:source':
      return `カタログを登録：${d.source}`;
    case 'catalog:source-edit':
      return `カタログの設定を変更：${d.source}`;
    case 'catalog:import':
      return `カタログを取り込み：${d.source}（読み取り ${d.found}件・新規 ${d.created}・変更 ${d.updated}・掲載なし ${d.missing}）`;
    case 'catalog:item': {
      const parts = [];
      if (d.active !== undefined) parts.push(d.active ? '使う' : '使わない');
      if (d.tax_rate !== undefined) parts.push(`税率 ${d.tax_rate}%`);
      if (d.unit !== undefined) parts.push(`単位 ${d.unit}`);
      return `商品を編集：${d.item}（${parts.join('・')}）`;
    }
    case 'intake:field-added':
      return `依頼フォームに項目を追加：${d.label}`;
    case 'intake:field-changed':
      return `依頼フォームの項目を変更：${d.label}${d.active === false ? '（使わない）' : ''}`;
    case 'maker:added':
      return `メーカーを登録：${d.name}`;
    case 'maker:changed':
      return `メーカーを変更：${d.name}${d.active === false ? '（使わない）' : ''}`;
    default:
      return a.action;
  }
}
