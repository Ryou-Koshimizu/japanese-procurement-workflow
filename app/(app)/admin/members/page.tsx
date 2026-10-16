import { redirect } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listStores } from '../../../../src/server/service';
import { roleLabels } from '../../../../src/core/workflow';
import { Building2, Store, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const { stores, hq } = await listStores(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Users className="icon sm" aria-hidden="true" />
            本社 管理者
          </span>
          <h1>店舗とメンバー</h1>
          <p className="sub">
            店舗スタッフは自分の店舗の依頼だけを見られ、本社は全店舗の依頼を見られます（データベースの行レベルセキュリティで分けています）。通知は店舗側＝その店舗のスタッフ全員、本社側＝購買担当と管理者に届きます。
          </p>
        </div>
      </div>
      <div className="stack">
        <section className="card" aria-labelledby="hq-heading">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="hq-heading">
              <Building2 className="icon" aria-hidden="true" />
              本社
            </h2>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>名前</th>
                <th>メールアドレス</th>
                <th>役割</th>
              </tr>
            </thead>
            <tbody>
              {hq.map((m) => (
                <tr key={m.email}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>{roleLabels[m.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card" aria-labelledby="stores-heading">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="stores-heading">
              <Store className="icon" aria-hidden="true" />
              店舗（{stores.length}）
            </h2>
          </div>
          <table className="list">
            <thead>
              <tr>
                <th>店舗コード</th>
                <th>店舗名</th>
                <th>スタッフ</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((st) => (
                <tr key={st.id}>
                  <td>{st.code}</td>
                  <td>{st.name}</td>
                  <td>
                    {st.members.length
                      ? st.members
                          .map((m) => `${m.name}（${m.email}）`)
                          .join('、')
                      : 'なし'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="meta-line">
          店舗・メンバーの追加は <code>npm run org:create</code>
          （設定ファイルから一括作成）で行います。
        </p>
      </div>
    </>
  );
}
