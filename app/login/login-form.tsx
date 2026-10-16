'use client';
import { useState } from 'react';

type DemoUser = { email: string; name: string; label: string; duty: string };

export default function LoginForm({
  demo,
  demoOrg,
  demoPassword,
  demoUsers,
}: {
  demo: boolean;
  demoOrg: string;
  demoPassword?: string;
  demoUsers: DemoUser[];
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: string, p: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password: p }),
      });
      if (!r.ok)
        throw new Error((await r.json()).error ?? 'ログインできませんでした。');
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {demo && (
        <section
          aria-labelledby="demo-heading"
          style={{ display: 'grid', gap: 10 }}
        >
          <h2 id="demo-heading" style={{ margin: 0 }}>
            公開デモ：役割を選んでログイン
          </h2>
          <p className="sub" style={{ margin: 0 }}>
            架空の「{demoOrg}
            」（3店舗と本社）です。カタログは架空の仕入先サイトから取り込んでいます。メールは送らず、画面の「通知」に記録します。
          </p>
          <div className="demo-users">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                className="demo-user"
                disabled={busy}
                onClick={() => submit(u.email, demoPassword!)}
              >
                <span>
                  <b>
                    {u.name}（{u.label}）
                  </b>
                  <small>{u.duty}</small>
                </span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(email, password);
        }}
        style={{ display: 'grid', gap: 10 }}
        aria-label="メールアドレスでログイン"
      >
        {demo && (
          <div className="meta-line">
            またはメールアドレスでログイン（デモのパスワード：{demoPassword}）
          </div>
        )}
        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary" disabled={busy} type="submit">
          ログイン
        </button>
      </form>
    </div>
  );
}
