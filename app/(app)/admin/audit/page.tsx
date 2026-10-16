import { redirect } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listAudit } from '../../../../src/server/service';
import { auditText } from '../../../../src/ui/audit';
import { formatDateTime } from '../../../../src/ui/format';

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
          <h1>監査ログ</h1>
          <p className="sub">
            状態の変更・見積・承諾・カタログの変更を、データベースのトリガーが記録します。アプリからは書き換えも削除もできません。
          </p>
        </div>
      </div>
      <div className="card scroll-x">
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
                <td>{text}</td>
                <td>{a.actor_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
