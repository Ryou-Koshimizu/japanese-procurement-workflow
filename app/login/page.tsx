import { redirect } from 'next/navigation';
import { FileCheck2, PackageCheck, Send, ShoppingCart } from 'lucide-react';
import { currentSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import {
  demoStores,
  demoUsers,
  DEMO_ORG,
  DEMO_PASSWORD,
} from '../../src/server/demo-seed';
import { roleLabels } from '../../src/core/workflow';
import ThemeSwitch from '../theme-switch';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

const duties = {
  store: 'カタログから発注を依頼し、届いた見積を承諾する',
  buyer: '店舗の依頼を承認して見積を送る（または却下）',
  admin: '仕入先サイトからカタログを取り込む・監査ログ',
} as const;

const flow = [
  {
    Icon: ShoppingCart,
    title: '店舗が依頼',
    text: 'カタログからカートに入れて本社へ',
  },
  {
    Icon: Send,
    title: '本社が承認して見積',
    text: '単価・数量・送料・有効期限を決める',
  },
  {
    Icon: FileCheck2,
    title: '店舗が承諾',
    text: '最新で期限内の見積だけ承諾できる',
  },
  {
    Icon: PackageCheck,
    title: '発注確定・金額を通知',
    text: '店舗・本社・仕入先へ同じ金額',
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
              <small>店舗の依頼・本社の見積・双方の合意で発注</small>
            </span>
          </div>
          <h1 id="hero-title">
            店舗の「これ欲しい」を、
            <br />
            合意した金額で発注まで。
          </h1>
          <p className="lead">
            仕入先のサイトから取り込んだカタログで店舗が依頼し、本社が見積を返し、店舗が承諾した時点で発注が確定します。確定した金額は店舗・本社・仕入先に同時に届きます。
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
            demoOrg={DEMO_ORG}
            demoPassword={demo ? DEMO_PASSWORD : undefined}
            demoUsers={
              demo
                ? demoUsers.map((u) => ({
                    email: u.email,
                    name: u.name,
                    kind: u.role === 'store' ? 'store' : 'hq',
                    label: u.store
                      ? `${demoStores.find((st) => st.code === u.store)!.name}の${roleLabels.store}`
                      : roleLabels[u.role],
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
