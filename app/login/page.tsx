import { redirect } from 'next/navigation';
import { CalendarCheck, Factory, FileCheck2, SquarePen } from 'lucide-react';
import { currentSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import {
  demoStores,
  demoUsers,
  DEMO_CLIENT,
  DEMO_ORG,
  DEMO_PASSWORD,
} from '../../src/server/demo-seed';
import { roleLabels } from '../../src/core/workflow';
import ThemeSwitch from '../theme-switch';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

const duties = {
  client: '決まった項目に答えて依頼し、届いた見積書に合意する',
  agent: '質問・商品概要・メーカーへの相見積・見積書・発注・納期の連絡',
  admin: '担当者の仕事に加えて、依頼フォーム・カタログ・メンバー・監査ログ',
} as const;

const flow = [
  {
    Icon: SquarePen,
    title: 'A社が依頼',
    text: 'B社が決めた項目に答えて送る',
  },
  {
    Icon: Factory,
    title: 'B社がメーカーに確認',
    text: '質問・商品概要・相見積',
  },
  {
    Icon: FileCheck2,
    title: '見積書に合意',
    text: 'A社に見えるのは売値だけ',
  },
  {
    Icon: CalendarCheck,
    title: '発注・納期のお知らせ',
    text: '納期が決まるとA社にメール',
  },
];

export default async function LoginPage() {
  if (await currentSession()) redirect('/');
  const { config } = await runtime();
  const demo = config.mode === 'demo';
  return (
    <>
      <div className="login-theme glass clear" data-lens>
        <ThemeSwitch />
      </div>
      <main className="login-wrap">
        <section className="login-hero" aria-labelledby="hero-title">
          <div className="brand" style={{ padding: 0 }}>
            <span className="seal" aria-hidden="true">
              発
            </span>
            <span>
              <b>備品発注ワークフロー</b>
              <small>依頼する会社・発注を代行する会社・メーカー</small>
            </span>
          </div>
          <h1 id="hero-title">
            拠点の「これがほしい」を、
            <br />
            メーカーへの発注と納期の連絡まで。
          </h1>
          <p className="lead">
            A社の拠点が決まった項目で依頼し、発注を代行するB社がヒアリングしてメーカーに見積を取り、経費と利益を載せた見積書を出します。A社が合意したらB社がメーカーに発注し、納期が決まるとA社にお知らせが届きます。メーカーの原価と利益は、データベースの権限でA社から見えません。
          </p>
          <ol className="flow">
            {flow.map(({ Icon, title, text }) => (
              <li key={title} className="glass clear" data-lens>
                <Icon className="icon lg" aria-hidden="true" />
                <b>{title}</b>
                <small>{text}</small>
              </li>
            ))}
          </ol>
        </section>
        <div className="login glass strong" data-lens>
          <LoginForm
            demo={demo}
            demoOrg={`${DEMO_CLIENT}（A社・3拠点）と${DEMO_ORG}（B社）`}
            demoPassword={demo ? DEMO_PASSWORD : undefined}
            demoUsers={
              demo
                ? demoUsers.map((u) => ({
                    email: u.email,
                    name: u.store
                      ? `A社 ${demoStores.find((st) => st.code === u.store)!.name} ${u.name}`
                      : `B社 ${u.name}`,
                    kind: u.role === 'client' ? 'store' : 'hq',
                    label: roleLabels[u.role],
                    duty: duties[u.role],
                  }))
                : []
            }
          />
        </div>
      </main>
    </>
  );
}
