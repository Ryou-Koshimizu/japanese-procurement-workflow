import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { counts } from '../../src/server/service';
import { isAgent, roleLabels } from '../../src/core/workflow';
import { Building2, FlaskConical, Store } from 'lucide-react';
import Nav from './nav';
import AccountMenu from './account-menu';
import ThemeSwitch from '../theme-switch';
import { LogoutButton, ResetDemoButton } from './session-buttons';
import Brand from '../brand';

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
  const demo = config.mode === 'demo';
  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <header className="top">
        <Brand sub={s.orgName} />
        <Nav role={s.role} todo={c.todo} variant="bar" />
        {demo && (
          <span className="demo-sticker" title="架空の会社・メーカーの公開デモ">
            <FlaskConical className="icon sm" aria-hidden="true" />
            公開デモ
          </span>
        )}
        <AccountMenu initial={s.userName.slice(0, 1)} name={s.userName}>
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
          <Nav role={s.role} todo={c.todo} variant="panel" />
          <div className="panel-foot">
            <ThemeSwitch />
            <LogoutButton />
          </div>
        </AccountMenu>
      </header>
      <main className="main" id="main">
        {children}
      </main>
      {demo && (
        <footer className="demo-foot" role="note" aria-label="公開デモについて">
          <b>
            <FlaskConical className="icon sm" aria-hidden="true" />
            公開デモ
          </b>
          <span>
            架空の会社・メーカーで動いています。メールは送らず「通知」に記録します。
            {config.sharedDatabase
              ? 'データは1日ごと、または「デモを初期化」で元に戻ります。'
              : 'データはサーバーの再起動で初期状態に戻ります。'}
          </span>
          <LogoutButton label="別の役割でログイン" variant="link" />
          {s.role === 'admin' && <ResetDemoButton />}
        </footer>
      )}
    </div>
  );
}
