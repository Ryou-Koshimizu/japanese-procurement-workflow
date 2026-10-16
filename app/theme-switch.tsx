'use client';
import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark' | 'auto';
const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'ライト', Icon: Sun },
  { value: 'dark', label: 'ダーク', Icon: Moon },
  { value: 'auto', label: '自動', Icon: Monitor },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'auto') localStorage.removeItem('theme');
    else localStorage.setItem('theme', theme);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** Light, dark or follow the system. Remembered in this browser. */
export default function ThemeSwitch({
  className = '',
}: {
  className?: string;
}) {
  const [theme, setTheme] = useState<Theme>('auto');
  useEffect(() => {
    const saved = document.documentElement.getAttribute('data-theme');
    setTheme(saved === 'light' || saved === 'dark' ? saved : 'auto');
    // Every screen has this switch, so this also says the page is now
    // interactive (tests wait for it before pressing buttons).
    document.documentElement.setAttribute('data-ready', '');
  }, []);
  return (
    <div
      className={`theme-switch ${className}`}
      role="group"
      aria-label="画面の明るさ"
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          title={label}
          onClick={() => {
            setTheme(value);
            apply(value);
          }}
        >
          <Icon className="icon sm" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
