import { redirect } from 'next/navigation';
import {
  CalendarCheck,
  Factory,
  FileCheck2,
  FlaskConical,
  KeyRound,
  ShieldCheck,
  SquarePen,
  Truck,
} from 'lucide-react';
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
import Brand from '../brand';
import { DemoUsers, EmailLogin } from './login-form';

export const dynamic = 'force-dynamic';

const duties = {
  client: '依頼する・質問に答える・見積書に合意',
  agent: 'ヒアリング・相見積・見積書・発注・納期',
  admin: '担当者の仕事＋依頼フォーム・メンバー・監査ログ',
} as const;

const flow = [
  {
    Icon: SquarePen,
    title: 'A社が依頼',
    text: 'B社が決めた項目に答えて送る。足りない点はアプリの中で質問が届く',
  },
  {
    Icon: Factory,
    title: 'B社が相見積',
    text: '商品概要を決めて登録メーカーに見積を依頼。A社の名前はメーカーに送らない',
  },
  {
    Icon: FileCheck2,
    title: '見積書に合意',
    text: '原価に率を載せた売値・送料・消費税をデータベースが計算。A社には売値だけ',
  },
  {
    Icon: Truck,
    title: '発注',
    text: '直送かB社経由かを選び、発注番号つきの発注書をメーカーへ',
  },
  {
    Icon: CalendarCheck,
    title: '納期のお知らせ',
    text: 'メーカーに確かめた納期を入れると、依頼した拠点の担当者に届く',
  },
];

const ticker = [
  '依頼',
  'ヒアリング',
  'メーカーの相見積',
  '見積書',
  '合意',
  '発注',
  '納期のお知らせ',
];

export default async function LoginPage() {
  if (await currentSession()) redirect('/');
  const { config } = await runtime();
  const demo = config.mode === 'demo';
  return (
    <>
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <header className="top">
        <Brand sub="依頼する会社・発注を代行する会社・メーカー" />
        <ThemeSwitch className="compact" />
      </header>
      <main id="main" className="login-main">
        <section className="hero" aria-labelledby="hero-title" data-hero>
          <div className="hero-copy">
            {demo && (
              <span className="sticker">
                <FlaskConical className="icon sm" aria-hidden="true" />
                公開デモ・会社もメーカーも架空
              </span>
            )}
            <h1 id="hero-title">
              {[
                '拠点の',
                '「これがほしい」を、',
                '発注と',
                '納期の連絡まで。',
              ].map((p) => (
                <span key={p} className="phrase">
                  {p}
                </span>
              ))}
            </h1>
            <p className="lead">
              A社の拠点が依頼し、B社がメーカーの相見積から見積書・発注・納期のお知らせまで進める業務システムです。
            </p>
          </div>
          <div className="hero-act card">
            {demo ? (
              <>
                <h2 id="demo-heading">
                  <KeyRound className="icon" aria-hidden="true" />
                  役割を選んでログイン
                </h2>
                <DemoUsers
                  password={DEMO_PASSWORD}
                  users={demoUsers.map((u) => ({
                    email: u.email,
                    name: u.name,
                    // 「A社 渋谷店・担当者」「B社・管理者」
                    where: `${
                      u.store
                        ? `A社 ${demoStores.find((st) => st.code === u.store)!.name}`
                        : 'B社'
                    }・${roleLabels[u.role].replace(/^[AB]社\s*/, '')}`,
                    kind: u.role === 'client' ? 'store' : 'hq',
                    duty: duties[u.role],
                  }))}
                />
              </>
            ) : (
              <>
                <h2>
                  <KeyRound className="icon" aria-hidden="true" />
                  ログイン
                </h2>
                <EmailLogin />
              </>
            )}
          </div>
        </section>

        <div className="after">
          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              {[0, 1].map((k) => (
                <span key={k}>
                  {ticker.map((t) => (
                    <span key={t}>
                      {t}
                      <i>→</i>
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>

          <section className="flow-wrap" aria-labelledby="flow-title">
            <h2 id="flow-title">依頼から納期のお知らせまで</h2>
            <ol className="flow">
              {flow.map(({ Icon, title, text }, i) => (
                <li key={title} className={`card c${i}`}>
                  <span className="flow-no num">{i + 1}</span>
                  <Icon className="icon lg" aria-hidden="true" />
                  <b>{title}</b>
                  <small>{text}</small>
                </li>
              ))}
            </ol>
          </section>

          <section className="guard card" aria-labelledby="guard-title">
            <h2 id="guard-title">
              <ShieldCheck className="icon" aria-hidden="true" />
              見せない仕組みはデータベースに
            </h2>
            <p>
              A社の画面・API・メールに原価・利益・メーカー名・B社メモが出ないことを、PostgreSQL
              の行単位の権限（RLS）とトリガーで守っています。金額の計算・状態の変更・監査ログも、すべてデータベースが行います。
            </p>
          </section>

          {demo && (
            <section className="card email-card" aria-labelledby="email-title">
              <h2 id="email-title">メールアドレスでログイン</h2>
              <EmailLogin
                hint={`架空の${DEMO_CLIENT}（A社・3拠点）と${DEMO_ORG}（B社）の4人です。パスワードは全員 ${DEMO_PASSWORD} です。`}
              />
            </section>
          )}
        </div>
      </main>
    </>
  );
}
