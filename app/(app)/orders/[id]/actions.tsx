'use client';
import { useState } from 'react';
import {
  quoteTotals,
  parseYen,
  yen,
  type TaxRate,
} from '../../../../src/core/money';
import Totals from '../../totals';

async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? '保存できませんでした。');
  return json;
}

type EditorLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  taxRate: TaxRate;
  referencePrice: number;
  requestedQty: number;
  unitPrice: number;
  qty: number;
  included: boolean;
};

export function QuoteEditor({
  orderId,
  basedOn,
  lines: initial,
  shippingFee: initialShipping,
  validUntil: initialValid,
  today,
}: {
  orderId: string;
  basedOn: number | null;
  lines: EditorLine[];
  shippingFee: number;
  validUntil: string;
  today: string;
}) {
  const [lines, setLines] = useState(
    initial.map((l) => ({
      ...l,
      priceText: String(l.unitPrice),
      qtyText: String(l.qty),
    })),
  );
  const [shipping, setShipping] = useState(String(initialShipping));
  const [validUntil, setValidUntil] = useState(initialValid);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = lines.map((l) => ({
    ...l,
    price: parseYen(l.priceText),
    n: /^\d{1,4}$/.test(l.qtyText.normalize('NFKC'))
      ? Number(l.qtyText.normalize('NFKC'))
      : null,
  }));
  const shippingFee = parseYen(shipping);
  const included = parsed.filter((l) => l.included);
  const invalid =
    shippingFee === null ||
    included.some((l) => l.price === null || !l.n || l.n < 1);
  const totals = quoteTotals(
    included.map((l) => ({
      unitPrice: l.price ?? 0,
      qty: l.n ?? 0,
      taxRate: l.taxRate,
    })),
    shippingFee ?? 0,
  );
  const update = (id: string, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  return (
    <div>
      <div className="scroll-x">
        <table className="list lines">
          <thead>
            <tr>
              <th>含める</th>
              <th>商品</th>
              <th className="num">単価（税抜）</th>
              <th className="num">数量</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((l) => (
              <tr key={l.id} className={l.included ? undefined : 'excluded'}>
                <td>
                  <input
                    type="checkbox"
                    checked={l.included}
                    aria-label={`${l.name}を見積に含める`}
                    onChange={(e) =>
                      update(l.id, { included: e.target.checked })
                    }
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: 'var(--accent)',
                    }}
                  />
                </td>
                <td className="name">
                  {l.name}
                  <span className="meta-line" style={{ display: 'block' }}>
                    参考 {yen(l.referencePrice)}・依頼 {l.requestedQty}
                    {l.unit}
                    {l.taxRate === 8 ? '・軽減税率8%' : ''}
                  </span>
                </td>
                <td className="num">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={l.priceText}
                    disabled={!l.included}
                    aria-label={`${l.name}の単価`}
                    aria-invalid={l.included && l.price === null}
                    onChange={(e) =>
                      update(l.id, { priceText: e.target.value })
                    }
                  />
                </td>
                <td className="num">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={l.qtyText}
                    disabled={!l.included}
                    aria-label={`${l.name}の数量`}
                    aria-invalid={l.included && (!l.n || l.n < 1)}
                    onChange={(e) => update(l.id, { qtyText: e.target.value })}
                    style={{ width: 72 }}
                  />
                </td>
                <td className="num">
                  {l.included && l.price !== null && l.n
                    ? yen(l.price * l.n)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid section">
        <div className="field">
          <label htmlFor="shipping">送料（税抜・10%対象）</label>
          <input
            id="shipping"
            type="text"
            inputMode="numeric"
            value={shipping}
            aria-invalid={shippingFee === null}
            onChange={(e) => setShipping(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="valid-until">見積の有効期限</label>
          <input
            id="valid-until"
            type="date"
            min={today}
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <div className="field wide">
          <label htmlFor="quote-note">店舗へのメモ（任意）</label>
          <textarea
            id="quote-note"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：詰替用は本社の年間契約価格で手配します。"
          />
        </div>
      </div>
      <Totals
        totals={totals}
        shippingFee={shippingFee ?? 0}
        label="見積合計（税込）"
      />
      {invalid && (
        <p
          className="meta-line"
          style={{ color: 'var(--error)', textAlign: 'right' }}
        >
          単価・数量・送料は整数の円で入力してください。
        </p>
      )}
      {error && (
        <div className="alert" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      <div className="actions section">
        <button
          className="btn primary"
          type="button"
          disabled={busy || invalid || !included.length || !validUntil}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await post(`/api/orders/${orderId}/quote`, {
                lines: included.map((l) => ({
                  orderLineId: l.id,
                  unitPrice: l.price,
                  qty: l.n,
                })),
                shippingFee,
                validUntil,
                note: note || null,
                basedOn,
              });
              window.location.reload();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {basedOn ? '再見積を送る' : '承認して見積を送る'}（{yen(totals.total)}
          ）
        </button>
        {!included.length && (
          <span className="meta-line">商品を1つ以上含めてください。</span>
        )}
      </div>
    </div>
  );
}

export function RejectForm({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <div className="section">
        <button
          className="btn danger"
          type="button"
          onClick={() => setOpen(true)}
        >
          この依頼を却下する
        </button>
      </div>
    );
  return (
    <div className="section field">
      <label htmlFor="reject-reason">却下の理由（店舗に届きます）</label>
      <textarea
        id="reject-reason"
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例：来週、本社の在庫から配送します。"
      />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button
          className="btn danger"
          type="button"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/api/orders/${orderId}/reject`, { reason });
              window.location.reload();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          却下する
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          やめる
        </button>
      </div>
    </div>
  );
}

export function StoreResponse({
  orderId,
  quoteId,
  total,
  expired,
}: {
  orderId: string;
  quoteId: string;
  total: number;
  expired: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'accept' | 'revise' | 'cancel'>(
    'idle',
  );
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(url: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await post(url, body);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="section" style={{ display: 'grid', gap: 12 }}>
      {mode === 'idle' && (
        <div className="actions">
          <button
            className="btn primary"
            type="button"
            disabled={expired}
            onClick={() => setMode('accept')}
          >
            この見積で発注する
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setMode('revise')}
          >
            修正を依頼する
          </button>
          <button
            className="btn danger"
            type="button"
            onClick={() => setMode('cancel')}
          >
            依頼を取り下げる
          </button>
          {expired && (
            <span className="meta-line" style={{ color: 'var(--error)' }}>
              有効期限が切れています。修正を依頼して再見積を受け取ってください。
            </span>
          )}
        </div>
      )}
      {mode === 'accept' && (
        <div className="confirm-box" role="group" aria-label="発注の確認">
          <b>合計 {yen(total)}（税込）で発注を確定します。</b>
          <span className="meta-line">
            確定すると、店舗と本社に発注金額が通知され、仕入先に発注書が送られます。確定後は取り消せません。
          </span>
          <div className="actions">
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => run(`/api/orders/${orderId}/accept`, { quoteId })}
            >
              発注を確定する
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setMode('idle')}
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {(mode === 'revise' || mode === 'cancel') && (
        <div className="field">
          <label htmlFor="response-text">
            {mode === 'revise'
              ? '修正してほしい内容（本社に届きます）'
              : '取り下げの理由（任意）'}
          </label>
          <textarea
            id="response-text"
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'revise' ? '例：紙袋は2束で足ります。' : ''}
          />
          <div className="actions">
            <button
              className={mode === 'revise' ? 'btn primary' : 'btn danger'}
              type="button"
              disabled={busy || (mode === 'revise' && !text.trim())}
              onClick={() =>
                mode === 'revise'
                  ? run(`/api/orders/${orderId}/revision`, {
                      quoteId,
                      note: text,
                    })
                  : run(`/api/orders/${orderId}/cancel`, {
                      reason: text || null,
                    })
              }
            >
              {mode === 'revise' ? '修正を依頼する' : '取り下げる'}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setMode('idle')}
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function CancelRequest({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <div className="actions">
        <button
          className="btn danger"
          type="button"
          onClick={() => setOpen(true)}
        >
          依頼を取り下げる
        </button>
        <span className="meta-line">本社の見積を待っています。</span>
      </div>
    );
  return (
    <div className="field">
      <label htmlFor="cancel-reason">取り下げの理由（任意）</label>
      <textarea
        id="cancel-reason"
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button
          className="btn danger"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/api/orders/${orderId}/cancel`, {
                reason: reason || null,
              });
              window.location.reload();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          取り下げる
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          戻る
        </button>
      </div>
    </div>
  );
}
