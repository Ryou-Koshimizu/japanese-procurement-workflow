'use client';
import { useState } from 'react';
import {
  ArrowRight,
  Building2,
  LoaderCircle,
  LogIn,
  Store,
  TriangleAlert,
} from 'lucide-react';

export type DemoUser = {
  email: string;
  name: string;
  where: string;
  kind: 'store' | 'hq';
  duty: string;
};

async function login(email: string, password: string) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok)
    throw new Error((await r.json()).error ?? 'ログインできませんでした。');
  window.location.assign('/');
}

function ErrorBox({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="alert" role="alert">
      <TriangleAlert className="icon" aria-hidden="true" />
      {message}
    </div>
  );
}

/** The four demo people: one press logs in as that person. */
export function DemoUsers({
  users,
  password,
}: {
  users: DemoUser[];
  password: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <>
      <div className="demo-users">
        {users.map((u, i) => (
          <button
            key={u.email}
            type="button"
            className={`demo-user c${i}`}
            disabled={!!busy}
            data-busy={busy === u.email || undefined}
            onClick={async () => {
              setBusy(u.email);
              setError('');
              try {
                await login(u.email, password);
              } catch (e) {
                setError((e as Error).message);
                setBusy(null);
              }
            }}
          >
            <span className={`r-icon ${u.kind}`} aria-hidden="true">
              {u.kind === 'store' ? (
                <Store className="icon" />
              ) : (
                <Building2 className="icon" />
              )}
            </span>
            <b>{u.name}</b>
            <small className="where">{u.where}</small>
            <small className="duty">{u.duty}</small>
            <span className="go" aria-hidden="true">
              {busy === u.email ? (
                <LoaderCircle className="icon spin" />
              ) : (
                <ArrowRight className="icon" />
              )}
            </span>
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
    </>
  );
}

/** Log in with an email address and a password. */
export function EmailLogin({ hint }: { hint?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="email-login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await login(email, password);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
      aria-label="メールアドレスでログイン"
    >
      {hint && <p className="meta-line">{hint}</p>}
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
      <ErrorBox message={error} />
      <button className="btn primary big" disabled={busy} type="submit">
        <LogIn className="icon" aria-hidden="true" />
        ログイン
      </button>
    </form>
  );
}
