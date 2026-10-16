'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Cart } from '../../../src/server/service';
import { quoteTotals, yen } from '../../../src/core/money';
import { Stepper } from '../catalog/add-to-cart';
import Totals from '../totals';

export default function CartEditor({
  cart,
  today,
}: {
  cart: Cart;
  today: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(cart.lines);
  const [neededBy, setNeededBy] = useState(cart.needed_by ?? '');
  const [note, setNote] = useState(cart.note ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const totals = quoteTotals(
    lines.map((l) => ({
      unitPrice: l.unit_price,
      qty: l.qty,
      taxRate: l.tax_rate,
    })),
  );
  const blocked = lines.some((l) => !l.orderable);

  async function call(url: string, method: string, body?: unknown) {
    setError('');
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error ?? '保存できませんでした。');
    return json;
  }

  async function setQty(id: string, qty: number) {
    const before = lines;
    setLines((ls) =>
      qty === 0
        ? ls.filter((l) => l.id !== id)
        : ls.map((l) => (l.id === id ? { ...l, qty } : l)),
    );
    try {
      await call(`/api/cart/lines/${id}`, 'PATCH', { qty });
      router.refresh();
    } catch (e) {
      setLines(before);
      setError((e as Error).message);
    }
  }

  return (
    <section className="card pad" aria-labelledby={`cart-${cart.order_id}`}>
      <div className="quote-head">
        <h2 id={`cart-${cart.order_id}`} style={{ margin: 0 }}>
          仕入先：{cart.source_name}
        </h2>
        <span className="meta-line">価格は取り込み時点の参考価格（税抜）</span>
      </div>
      <div className="scroll-x">
        <table className="list lines">
          <thead>
            <tr>
              <th>商品</th>
              <th className="num">参考単価</th>
              <th>数量</th>
              <th className="num">小計</th>
              <th>
                <span className="hide-sm">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <div className="item-cell">
                    {l.image_id ? (
                      <img
                        className="thumb"
                        src={`/api/catalog/images/${l.image_id}`}
                        alt=""
                        width={44}
                        height={44}
                      />
                    ) : (
                      <span className="thumb" aria-hidden="true" />
                    )}
                    <span>
                      {l.name}
                      <span className="meta-line" style={{ display: 'block' }}>
                        {l.sku}
                        {l.tax_rate === 8 ? '・軽減税率8%' : ''}
                        {!l.orderable && (
                          <b style={{ color: 'var(--error)' }}>
                            ・現在は発注できません
                          </b>
                        )}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="num">{yen(l.unit_price)}</td>
                <td>
                  <Stepper
                    value={l.qty}
                    onChange={(n) => setQty(l.id, n)}
                    label={l.name}
                  />
                </td>
                <td className="num">{yen(l.unit_price * l.qty)}</td>
                <td>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setQty(l.id, 0)}
                  >
                    外す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totals totals={totals} label="参考の合計（税込）" />

      <div className="form-grid section">
        <div className="field">
          <label htmlFor={`needed-${cart.order_id}`}>希望納期（任意）</label>
          <input
            id={`needed-${cart.order_id}`}
            type="date"
            min={today}
            value={neededBy}
            onChange={(e) => setNeededBy(e.target.value)}
          />
        </div>
        <div className="field wide">
          <label htmlFor={`note-${cart.order_id}`}>本社へのメモ（任意）</label>
          <textarea
            id={`note-${cart.order_id}`}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：レシートロールの在庫が残り3巻です。"
          />
        </div>
      </div>
      {error && (
        <div className="alert" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      <div className="actions section">
        <button
          className="btn primary"
          type="button"
          disabled={busy || !lines.length || blocked}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await call(
                `/api/cart/${cart.order_id}/submit`,
                'POST',
                { neededBy: neededBy || null, note },
              );
              window.location.assign(`/orders/${r.orderId}`);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          本社に依頼する
        </button>
        <button
          className="btn danger"
          type="button"
          disabled={busy}
          onClick={async () => {
            try {
              await call(`/api/cart/${cart.order_id}`, 'DELETE');
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          カートを空にする
        </button>
        {blocked && (
          <span className="meta-line">
            発注できない商品を外してから依頼してください。
          </span>
        )}
      </div>
    </section>
  );
}
