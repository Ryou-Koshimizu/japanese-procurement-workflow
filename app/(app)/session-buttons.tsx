'use client';
import { useState } from 'react';

export function LogoutButton({ label = 'ログアウト' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      {label}
    </button>
  );
}

export function ResetDemoButton() {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" onClick={() => setAsking(true)}>
        デモを初期化
      </button>
    );
  return (
    <span>
      データを初期状態に戻しますか？{' '}
      <button
        type="button"
        onClick={async () => {
          await fetch('/api/demo/reset', { method: 'POST' });
          window.location.assign('/login');
        }}
      >
        初期化する
      </button>{' '}
      <button type="button" onClick={() => setAsking(false)}>
        やめる
      </button>
    </span>
  );
}
