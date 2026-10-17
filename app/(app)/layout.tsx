import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { counts } from '../../src/server/service';
import { isAgent, roleLabels } from '../../src/core/workflow';
import { Building2, Store, TriangleAlert } from 'lucide-react';
import Nav from './nav';
import ThemeSwitch from '../theme-switch';
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
  const hq = isAgent(s.role);
  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <aside className="side pane" data-lens>
        <a className="brand" href="/">
          <span className="seal" aria-hidden="true">
            発
          </span>
          <span>
            <b>備品発注ワークフロー</b>
            <small>{s.orgName}</small>
          </span>
        </a>
        <Nav role={s.role} todo={c.todo} />
        <div className="side-foot">
          <div className="who">
            <span className="avatar" aria-hidden="true">
              {s.userName.slice(0, 1)}
            </span>
            <b>{s.userName}</b>
            <small>{s.email}</small>
            <span className={`role-chip ${hq ? 'role-hq' : 'role-store'}`}>
              {hq ? (
                <Building2 className="icon sm" aria-hidden="true" />
              ) : (
                <Store className="icon sm" aria-hidden="true" />
              )}
              {s.storeName ? `A社 ${s.storeName}・` : ''}
              {roleLabels[s.role]}
            </span>
          </div>
          <ThemeSwitch />
          <LogoutButton />
        </div>
      </aside>
      <main className="main" id="main">
        {config.mode === 'demo' && (
          <div className="demo-bar glass clear" role="note">
            <b>
              <TriangleAlert className="icon sm" aria-hidden="true" />
              公開デモ
            </b>
            <span>
              架空の会社・メーカーで動いています。メールは送らず「通知」に記録します。
              {config.sharedDatabase
                ? 'データは1日ごと、または「デモを初期化」で元に戻ります。'
                : 'データはサーバー再起動で初期化されます。'}
            </span>
            <LogoutButton label="別の役割でログイン" variant="link" />
            {s.role === 'admin' && <ResetDemoButton />}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
