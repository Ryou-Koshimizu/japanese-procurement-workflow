'use client';
import { usePathname } from 'next/navigation';
import type { Role } from '../../src/core/workflow';

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
  const items: {
    href: string;
    label: string;
    count?: number;
    what?: string;
  }[] =
    role === 'store'
      ? [
          { href: '/catalog', label: 'カタログ' },
          { href: '/cart', label: 'カート', count: cart, what: 'カートの数量' },
          { href: '/', label: '依頼一覧', count: todo, what: '承諾待ちの見積' },
          { href: '/notifications', label: '通知' },
        ]
      : [
          { href: '/', label: '依頼一覧', count: todo, what: '見積待ちの依頼' },
          { href: '/catalog', label: 'カタログ' },
          ...(role === 'admin'
            ? [
                { href: '/admin/catalog', label: 'カタログ管理' },
                { href: '/admin/members', label: '店舗とメンバー' },
                { href: '/admin/audit', label: '監査ログ' },
              ]
            : []),
          { href: '/notifications', label: '通知' },
        ];
  const active = (href: string) =>
    href === '/'
      ? path === '/' || path.startsWith('/orders')
      : path === href || path.startsWith(`${href}/`);
  return (
    <nav aria-label="メニュー">
      {items.map((i) => (
        <a
          key={i.href}
          href={i.href}
          aria-current={active(i.href) ? 'page' : undefined}
        >
          {i.label}
          {!!i.count && (
            <span className="count" aria-label={`${i.what} ${i.count}`}>
              {i.count}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
