'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';

export function LogoutButton({
  label = 'ログアウト',
  variant = 'icon',
}: {
  label?: string;
  variant?: 'icon' | 'link';
}) {
  const go = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  };
  if (variant === 'link')
    return (
      <button type="button" className="link-btn" onClick={go}>
        {label}
      </button>
    );
  return (
    <button type="button" className="icon-btn" onClick={go} title={label}>
      <LogOut className="icon" aria-hidden="true" />
      <span className="logout-label">{label}</span>
    </button>
  );
}

export function ResetDemoButton() {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="link-btn"
        onClick={() => setAsking(true)}
      >
        デモを初期化
      </button>
    );
  return (
    <span>
      データを初期状態に戻しますか？{' '}
      <button
        type="button"
        className="link-btn"
        onClick={async () => {
          await fetch('/api/demo/reset', { method: 'POST' });
          window.location.assign('/login');
        }}
      >
        初期化する
      </button>{' '}
      <button
        type="button"
        className="link-btn"
        onClick={() => setAsking(false)}
      >
        やめる
      </button>
    </span>
  );
}
