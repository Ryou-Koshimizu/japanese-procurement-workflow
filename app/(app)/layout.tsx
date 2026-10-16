import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { counts } from '../../src/server/service';
import { roleLabels } from '../../src/core/workflow';
import Nav from './nav';
import { LogoutButton, ResetDemoButton } from './session-buttons';

export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await pageSession();
  const { config, deps } = await runtime();
  const c = await counts(deps, s);
  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <aside className="side">
        <a className="brand" href="/">
          <span className="seal">発</span>
          <span>
            <b>備品発注ワークフロー</b>
            <small>{s.orgName}</small>
          </span>
        </a>
        <Nav role={s.role} todo={c.todo} cart={c.cart} />
        <div className="who">
          <b>{s.userName}</b>
          <span className="who-email">{s.email}</span>
          <span className="role-chip">
            {s.storeName ? `${s.storeName}・` : ''}
            {roleLabels[s.role]}
          </span>
          <LogoutButton />
        </div>
      </aside>
      <main className="main" id="main">
        {config.mode === 'demo' && (
          <div className="demo-bar" role="note">
            <b>公開デモ</b>
            <span>
              架空の会社・仕入先で動いています。メールは送らず「通知」に記録します。
              {config.sharedDatabase
                ? 'データは1日ごと、または「デモを初期化」で元に戻ります。'
                : 'データはサーバー再起動で初期化されます。'}
            </span>
            <LogoutButton label="別の役割でログイン" />
            {s.role === 'admin' && <ResetDemoButton />}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
