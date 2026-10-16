'use client';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import {
  Bell,
  ListChecks,
  PackageSearch,
  ScrollText,
  ShoppingCart,
  Store,
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

export default function Nav({
  role,
  todo,
  cart,
}: {
  role: Role;
  todo: number;
  cart: number;
}) {
  const path = usePathname();
  const items: Item[] =
    role === 'store'
      ? [
          { href: '/catalog', label: 'カタログ', Icon: Store },
          {
            href: '/cart',
            label: 'カート',
            Icon: ShoppingCart,
            count: cart,
            what: 'カートの数量',
          },
          {
            href: '/',
            label: '依頼一覧',
            Icon: ListChecks,
            count: todo,
            what: '承諾待ちの見積',
          },
          { href: '/notifications', label: '通知', Icon: Bell },
        ]
      : [
          {
            href: '/',
            label: '依頼一覧',
            Icon: ListChecks,
            count: todo,
            what: '見積待ちの依頼',
          },
          {
            href: '/catalog',
            label: 'カタログ',
            Icon: Store,
            wideOnly: role === 'admin',
          },
          ...(role === 'admin'
            ? [
                {
                  href: '/admin/catalog',
                  label: 'カタログ管理',
                  Icon: PackageSearch,
                },
                {
                  href: '/admin/members',
                  label: '店舗とメンバー',
                  Icon: Users,
                },
                { href: '/admin/audit', label: '監査ログ', Icon: ScrollText },
              ]
            : []),
          { href: '/notifications', label: '通知', Icon: Bell },
        ];
  // Badges bounce when their number changes, not on every page load.
  const atLoad = useRef({ cart, todo }).current;
  const active = (href: string) =>
    href === '/'
      ? path === '/' || path.startsWith('/orders')
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
              className={
                count !== (href === '/cart' ? atLoad.cart : atLoad.todo)
                  ? 'count bump'
                  : 'count'
              }
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
