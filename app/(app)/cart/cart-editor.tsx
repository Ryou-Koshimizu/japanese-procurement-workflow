'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Send, Store, Trash2, TriangleAlert } from 'lucide-react';
import type { Cart } from '../../../src/server/service';
import { quoteTotals, yen } from '../../../src/core/money';
import { Stepper } from '../catalog/add-to-cart';
import Totals from '../totals';
import { MorphButton, settle, type MorphState } from '../../../src/ui/morph';

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
  const [state, setState] = useState<MorphState>('idle');
  const totals = quoteTotals(
    lines.map((l) => ({
      unitPrice: l.unit_price,
      qty: l.qty,
      taxRate: l.tax_rate,
    })),
  );
  const blocked = lines.some((l) => !l.orderable);
  const id = cart.order_id;

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

  async function setQty(lineId: string, qty: number) {
    const before = lines;
    setLines((ls) =>
      qty === 0
        ? ls.filter((l) => l.id !== lineId)
        : ls.map((l) => (l.id === lineId ? { ...l, qty } : l)),
    );
    try {
      await call(`/api/cart/lines/${lineId}`, 'PATCH', { qty });
      router.refresh();
    } catch (e) {
      setLines(before);
      setError((e as Error).message);
    }
  }

  return (
    <div className="cart-layout">
      <section className="card pad" aria-labelledby={`cart-${id}`}>
        <div className="quote-head">
          <h2 id={`cart-${id}`}>
            <Store className="icon" aria-hidden="true" />
            仕入先：{cart.source_name}
          </h2>
          <span className="meta-line">
            価格は取り込み時点の参考価格（税抜）
          </span>
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
                  <span className="sr-only">操作</span>
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
                          width={48}
                          height={48}
                        />
                      ) : (
                        <span className="thumb" aria-hidden="true" />
                      )}
                      <span>
                        {l.name}
                        <span
                          className="meta-line"
                          style={{ display: 'block' }}
                        >
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
                  <td className="num">
                    <b>{yen(l.unit_price * l.qty)}</b>
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => setQty(l.id, 0)}
                      aria-label={`${l.name}を外す`}
                      title="外す"
                    >
                      <Trash2 className="icon" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="card pad summary sticky" aria-label="依頼の内容">
        <h2>本社に依頼する</h2>
        <Totals totals={totals} label="参考の合計（税込）" />
        <span className="meta-line">
          発注する金額は、本社が送る見積で決まります。
        </span>
        <div className="field">
          <label htmlFor={`needed-${id}`}>希望納期（任意）</label>
          <input
            id={`needed-${id}`}
            type="date"
            min={today}
            value={neededBy}
            onChange={(e) => setNeededBy(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`note-${id}`}>本社へのメモ（任意）</label>
          <textarea
            id={`note-${id}`}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：レシートロールの在庫が残り3巻です。"
          />
        </div>
        {error && (
          <div className="alert" role="alert">
            <TriangleAlert className="icon" aria-hidden="true" />
            {error}
          </div>
        )}
        {blocked && (
          <div className="alert" role="note">
            <TriangleAlert className="icon" aria-hidden="true" />
            発注できない商品を外してから依頼してください。
          </div>
        )}
        <MorphButton
          className="btn primary big"
          type="button"
          state={state}
          disabled={!lines.length || blocked}
          onClick={async () => {
            setState('busy');
            try {
              const r = await call(`/api/cart/${id}/submit`, 'POST', {
                neededBy: neededBy || null,
                note,
              });
              setState('done');
              await settle();
              window.location.assign(`/orders/${r.orderId}`);
            } catch (e) {
              setError((e as Error).message);
              setState('idle');
            }
          }}
        >
          <Send className="icon" aria-hidden="true" />
          本社に依頼する
        </MorphButton>
        <button
          className="btn danger ghost"
          type="button"
          disabled={state !== 'idle'}
          onClick={async () => {
            try {
              await call(`/api/cart/${id}`, 'DELETE');
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Trash2 className="icon" aria-hidden="true" />
          カートを空にする
        </button>
      </aside>
    </div>
  );
}
