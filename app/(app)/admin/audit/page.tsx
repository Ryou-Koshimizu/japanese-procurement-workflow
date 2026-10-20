import { redirect } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listAudit } from '../../../../src/server/service';
import { auditText } from '../../../../src/ui/audit';
import { formatDateTime } from '../../../../src/ui/format';
import { ScrollText } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const entries = (await listAudit(deps, s))
    .map((a) => ({ a, text: auditText(a) }))
    .filter((x) => x.text);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ScrollText className="icon sm" aria-hidden="true" />
            B社 管理者
          </span>
          <h1>監査ログ</h1>
          <p className="sub">
            依頼の状態・質問と回答・メーカーへの見積依頼・見積書・合意・発注・依頼フォームやメーカーの変更を、データベースのトリガーが記録します。原価や利益の金額は記録に書きません。アプリからは書き換えも削除もできません。
          </p>
        </div>
      </div>
      <div
        className="card scroll-x"
        role="region"
        aria-label="監査ログ"
        tabIndex={0}
      >
        <table className="list">
          <thead>
            <tr>
              <th>日時</th>
              <th>依頼</th>
              <th>内容</th>
              <th>操作した人</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ a, text }) => (
              <tr key={a.id}>
                <td className="meta-line" style={{ whiteSpace: 'nowrap' }}>
                  {formatDateTime(a.at)}
                </td>
                <td>
                  {a.order_id ? (
                    <a href={`/orders/${a.order_id}`}>
                      {a.request_number ?? '—'}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="wide-cell">{text}</td>
                <td className="nowrap">{a.actor_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
