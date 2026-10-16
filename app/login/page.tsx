import { redirect } from 'next/navigation';
import { currentSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import {
  demoStores,
  demoUsers,
  DEMO_ORG,
  DEMO_PASSWORD,
} from '../../src/server/demo-seed';
import { roleLabels } from '../../src/core/workflow';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

const duties = {
  store: 'カタログから発注を依頼し、届いた見積を承諾する',
  buyer: '店舗の依頼を承認して見積を送る（または却下）',
  admin: '仕入先サイトからカタログを取り込む・監査ログ',
} as const;

export default async function LoginPage() {
  if (await currentSession()) redirect('/');
  const { config } = await runtime();
  const demo = config.mode === 'demo';
  return (
    <main className="login-wrap">
      <div className="login card pad">
        <div
          className="brand"
          style={{ color: 'var(--ink)', padding: 0, marginBottom: 18 }}
        >
          <span className="seal">発</span>
          <span>
            <b>備品発注ワークフロー</b>
            <small style={{ color: 'var(--ink-3)' }}>
              店舗の依頼・本社の見積・双方の合意で発注
            </small>
          </span>
        </div>
        <LoginForm
          demo={demo}
          demoOrg={DEMO_ORG}
          demoPassword={demo ? DEMO_PASSWORD : undefined}
          demoUsers={
            demo
              ? demoUsers.map((u) => ({
                  email: u.email,
                  name: u.name,
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
  );
}
