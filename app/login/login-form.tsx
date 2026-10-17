'use client';
import { useState } from 'react';
import {
  Building2,
  ChevronRight,
  LoaderCircle,
  Store,
  TriangleAlert,
} from 'lucide-react';

type DemoUser = {
  email: string;
  name: string;
  kind: 'store' | 'hq';
  label: string;
  duty: string;
};

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
  const [busy, setBusy] = useState<string | null>(null);

  async function submit(e: string, p: string) {
    setBusy(e);
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
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {demo && (
        <section
          aria-labelledby="demo-heading"
          style={{ display: 'grid', gap: 12 }}
        >
          <h2 id="demo-heading" style={{ margin: 0 }}>
            公開デモ：役割を選んでログイン
          </h2>
          <p className="sub" style={{ margin: 0 }}>
            架空の{demoOrg}
            です。メーカーも架空です。メールは送らず、画面の「通知」に記録します。
          </p>
          <div className="demo-users">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                className="demo-user"
                disabled={!!busy}
                onClick={() => submit(u.email, demoPassword!)}
              >
                <span className={`r-icon ${u.kind}`} aria-hidden="true">
                  {u.kind === 'store' ? (
                    <Store className="icon" />
                  ) : (
                    <Building2 className="icon" />
                  )}
                </span>
                <b>
                  {u.name}（{u.label}）
                </b>
                <small>{u.duty}</small>
                <span className="go" aria-hidden="true">
                  {busy === u.email ? (
                    <LoaderCircle className="icon spin" />
                  ) : (
                    <ChevronRight className="icon" />
                  )}
                </span>
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
        style={{ display: 'grid', gap: 12 }}
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
            <TriangleAlert className="icon" aria-hidden="true" />
            {error}
          </div>
        )}
        <button className="btn primary big" disabled={!!busy} type="submit">
          ログイン
        </button>
      </form>
    </div>
  );
}
