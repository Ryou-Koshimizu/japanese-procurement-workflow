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
  const { org, stores, agents } = await listStores(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Users className="icon sm" aria-hidden="true" />
            B社 管理者
          </span>
          <h1>メンバー</h1>
          <p className="sub">
            A社の担当者は自分の拠点の依頼だけを見られ、B社は全拠点の依頼を見られます（データベースの行レベルセキュリティで分けています）。A社にはメーカーの名前・原価・利益・B社メモは見えません。
          </p>
        </div>
      </div>
      <div className="stack">
        <section className="card" aria-labelledby="agents-heading">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="agents-heading">
              <Building2 className="icon" aria-hidden="true" />
              B社：{org?.name}
            </h2>
            <p className="meta-line">
              受入先（B社経由で届けるとき）：{org?.address ?? '未登録'}
            </p>
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
              {agents.map((m) => (
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
              A社：{org?.client_name}（{stores.length}拠点）
            </h2>
          </div>
          <div className="scroll-x">
            <table className="list">
              <thead>
                <tr>
                  <th>コード</th>
                  <th>拠点</th>
                  <th>住所</th>
                  <th>担当者</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((st) => (
                  <tr key={st.id}>
                    <td>{st.code}</td>
                    <td>{st.name}</td>
                    <td>{st.address ?? '—'}</td>
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
          </div>
        </section>
        <p className="meta-line">
          拠点・メンバーの追加は <code>npm run org:create</code>
          （設定ファイルから一括作成）で行います。
        </p>
      </div>
    </>
  );
}
