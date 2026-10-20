'use client';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import {
  Bell,
  Factory,
  House,
  ListChecks,
  ScrollText,
  SquarePen,
  Store,
  TextCursorInput,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '../../src/core/workflow';

type Item = {
  href: string;
  label: string;
  Icon: LucideIcon;
  count?: number;
  what?: string;
  /** B社 管理者 only: kept in the menu, out of the header bar. */
  admin?: boolean;
};

function items(role: Role, todo: number): Item[] {
  const home: Item = {
    href: '/',
    label: 'ホーム',
    Icon: House,
    count: todo,
    what: 'あなたの番の依頼',
  };
  const bell: Item = { href: '/notifications', label: '通知', Icon: Bell };
  if (role === 'client')
    return [
      home,
      { href: '/requests/new', label: '依頼する', Icon: SquarePen },
      bell,
    ];
  return [
    home,
    { href: '/orders', label: '依頼', Icon: ListChecks },
    { href: '/makers', label: 'メーカー', Icon: Factory },
    { href: '/catalog', label: 'カタログ', Icon: Store },
    bell,
    ...(role === 'admin'
      ? [
          {
            href: '/admin/fields',
            label: '依頼フォーム',
            Icon: TextCursorInput,
            admin: true,
          },
          {
            href: '/admin/members',
            label: 'メンバー',
            Icon: Users,
            admin: true,
          },
          {
            href: '/admin/audit',
            label: '監査ログ',
            Icon: ScrollText,
            admin: true,
          },
        ]
      : []),
  ];
}

/**
 * The menu. "bar" sits in the header on wide screens (without the admin
 * pages); "panel" is the list in the menu panel: every page on narrow
 * screens, the admin pages on wide ones.
 */
export default function Nav({
  role,
  todo,
  variant,
}: {
  role: Role;
  todo: number;
  variant: 'bar' | 'panel';
}) {
  const path = usePathname();
  // The badge bounces when its number changes, not on every page load.
  const atLoad = useRef(todo).current;
  const active = (href: string) =>
    href === '/'
      ? path === '/'
      : href === '/orders'
        ? path === '/orders' || path.startsWith('/orders/')
        : path === href || path.startsWith(`${href}/`);
  const list = items(role, todo).filter((i) => variant === 'panel' || !i.admin);
  return (
    <nav
      className={variant === 'bar' ? 'nav' : 'nav panel-nav'}
      aria-label={variant === 'bar' ? 'メニュー' : 'すべてのページ'}
    >
      {list.map(({ href, label, Icon, count, what, admin }) => (
        <a
          key={href}
          href={href}
          aria-current={active(href) ? 'page' : undefined}
          className={admin ? 'admin-item' : undefined}
        >
          {active(href) && (
            // The block under the current item. Between pages the view
            // transition slides it from the old item to the new one.
            <span
              className="ind"
              style={variant === 'bar' ? { viewTransitionName: 'nav-ind' } : {}}
              aria-hidden="true"
            />
          )}
          <Icon className="icon" aria-hidden="true" />
          <span className="label">{label}</span>
          {!!count && (
            <span
              key={count}
              className={count !== atLoad ? 'count bump' : 'count'}
              aria-label={`${what} ${count}`}
            >
              {count}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
