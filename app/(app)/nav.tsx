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
  /** Left out of the phone tab bar, which keeps to five items. */
  wideOnly?: boolean;
};

export default function Nav({ role, todo }: { role: Role; todo: number }) {
  const path = usePathname();
  const home: Item = {
    href: '/',
    label: 'ホーム',
    Icon: House,
    count: todo,
    what: 'あなたの番の依頼',
  };
  const bell: Item = { href: '/notifications', label: '通知', Icon: Bell };
  const items: Item[] =
    role === 'client'
      ? [
          home,
          { href: '/requests/new', label: '依頼する', Icon: SquarePen },
          bell,
        ]
      : [
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
                  wideOnly: true,
                },
                {
                  href: '/admin/members',
                  label: 'メンバー',
                  Icon: Users,
                  wideOnly: true,
                },
                {
                  href: '/admin/audit',
                  label: '監査ログ',
                  Icon: ScrollText,
                  wideOnly: true,
                },
              ]
            : []),
        ];
  // The badge bounces when its number changes, not on every page load.
  const atLoad = useRef(todo).current;
  const active = (href: string) =>
    href === '/'
      ? path === '/'
      : href === '/orders'
        ? path === '/orders' || path.startsWith('/orders/')
        : path === href || path.startsWith(`${href}/`);
  return (
    <nav className="nav" aria-label="メニュー">
      {items.map(({ href, label, Icon, count, what, wideOnly }) => (
        <a
          key={href}
          href={href}
          aria-current={active(href) ? 'page' : undefined}
          className={wideOnly ? 'wide-only' : undefined}
        >
          {active(href) && (
            // The glass lens over the current item. Between pages the view
            // transition carries it from the old item to the new one.
            <span
              className="lg-ind"
              style={{ viewTransitionName: 'nav-ind' }}
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
