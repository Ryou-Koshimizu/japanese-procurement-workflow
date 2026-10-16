import {
  Ban,
  Bell,
  ExternalLink,
  FileCheck2,
  Info,
  Mail,
  PackageCheck,
  PenLine,
  Send,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { listNotifications } from '../../../src/server/service';
import { isHq } from '../../../src/core/workflow';
import type { NotificationEvent } from '../../../src/core/notification';
import { shortDate } from '../../../src/ui/format';

export const dynamic = 'force-dynamic';

const statusText = {
  pending: '送信待ち',
  sending: '送信中',
  sent: '送信済み',
  failed: '送信に失敗（再試行します）',
  demo: 'デモのため送信なし',
} as const;
const audienceText = { store: '店舗', hq: '本社', supplier: '仕入先' } as const;
const eventIcon: Record<NotificationEvent, LucideIcon> = {
  requested: Send,
  quoted: FileCheck2,
  revision: PenLine,
  rejected: Ban,
  cancelled: Undo2,
  ordered: PackageCheck,
};

export default async function NotificationsPage() {
  const s = await pageSession();
  const { deps, config } = await runtime();
  const mails = await listNotifications(deps, s);
  const unsentLive = config.mode === 'live' && deps.mail.kind === 'none';
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Bell className="icon sm" aria-hidden="true" />
            {s.userName}
          </span>
          <h1>通知</h1>
          <p className="sub">
            あなた宛てに送ったメール
            {isHq(s.role) ? 'と、仕入先へ送った発注書' : ''}
            です。依頼・見積・発注確定のたびに、データベースが同じ処理の中で送信予定を記録します。
          </p>
        </div>
      </div>
      {config.mode === 'demo' && (
        <p className="notice" style={{ marginBottom: 16 }}>
          <Info className="icon" aria-hidden="true" />
          公開デモではメールを実際には送らず、送る予定だった内容をここに表示しています。
        </p>
      )}
      {unsentLive && (
        <p className="notice" style={{ marginBottom: 16 }}>
          <Info className="icon" aria-hidden="true" />
          メール送信（SMTP_URL）が設定されていないため、通知は送信待ちのまま保存されています。
        </p>
      )}
      {mails.length === 0 ? (
        <div className="card empty">
          <Mail className="icon" aria-hidden="true" />
          <b>まだ通知はありません</b>
        </div>
      ) : (
        <div className="mail-list">
          {mails.map((m) => {
            const Icon = eventIcon[m.event];
            return (
              <details key={m.id} className={`card mail ${m.event}`}>
                <summary>
                  <span className="m-icon" aria-hidden="true">
                    <Icon className="icon" />
                  </span>
                  <b>{m.subject}</b>
                  <span className="meta-line">{shortDate(m.created_at)}</span>
                  <span className="meta-line">
                    宛先：{m.to_email}（{audienceText[m.audience]}）
                  </span>
                  <span className="meta-line">{statusText[m.status]}</span>
                </summary>
                <pre>{m.body}</pre>
                <p style={{ padding: '0 20px 18px', margin: 0 }}>
                  <a className="btn" href={`/orders/${m.order_id}`}>
                    <ExternalLink className="icon" aria-hidden="true" />
                    この依頼を開く
                  </a>
                </p>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
