import { ArrowLeft, ShoppingCart } from 'lucide-react';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { getCarts } from '../../../src/server/service';
import { todayInJapan } from '../../../src/server/config';
import CartEditor from './cart-editor';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const s = await pageSession();
  const { deps } = await runtime();
  const carts = await getCarts(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ShoppingCart className="icon sm" aria-hidden="true" />
            {s.storeName ?? '本社'}
          </span>
          <h1>カート</h1>
          <p className="sub">
            内容を確かめて本社に依頼します。本社が承認して見積を送り、あなたの店舗が承諾した時点で発注が確定します。
          </p>
        </div>
        <a className="btn" href="/catalog">
          <ArrowLeft className="icon" aria-hidden="true" />
          カタログに戻る
        </a>
      </div>
      {s.role !== 'store' ? (
        <div className="card empty">
          <ShoppingCart className="icon" aria-hidden="true" />
          <b>カートは店舗スタッフが使います</b>
        </div>
      ) : carts.length === 0 ? (
        <div className="card empty">
          <ShoppingCart className="icon" aria-hidden="true" />
          <b>カートは空です</b>
          <span>
            カタログで数量を選んで「カートに入れる」を押してください。
          </span>
          <a className="btn primary" href="/catalog">
            カタログを開く
          </a>
        </div>
      ) : (
        <div className="stack">
          {carts.map((c) => (
            <CartEditor
              key={c.order_id}
              cart={JSON.parse(JSON.stringify(c))}
              today={todayInJapan()}
            />
          ))}
        </div>
      )}
    </>
  );
}
