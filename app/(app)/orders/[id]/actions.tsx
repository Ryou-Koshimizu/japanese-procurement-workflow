'use client';
// The forms on a request page. Each posts one action and reloads; the
// database decides whether it is allowed.
import { useMemo, useRef, useState } from 'react';
import {
  Ban,
  CalendarCheck,
  CircleCheck,
  Factory,
  ListPlus,
  PenLine,
  Plus,
  Save,
  Send,
  StickyNote,
  Trash,
  Truck,
  Undo2,
} from 'lucide-react';
import {
  MAX_MARKUP_BP,
  parseYen,
  quoteProfit,
  quoteTotals,
  sellingPrice,
  yen,
  type TaxRate,
} from '../../../../src/core/money';
import {
  deliveryModeLabels,
  stockLabels,
  type DeliveryMode,
  type Stock,
} from '../../../../src/core/workflow';
import { ErrorLine, send, useAction } from '../../../../src/ui/form';
import { MorphButton } from '../../../../src/ui/morph';
import { ScrollX } from '../../../../src/ui/format';
import Totals from '../../totals';

const intOr = (s: string) => {
  const t = s.normalize('NFKC').replace(/[,\s]/g, '');
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
};

// Hearing ---------------------------------------------------------------------------

export function MessageForm({
  orderId,
  kind,
  label,
  button,
  placeholder,
}: {
  orderId: string;
  kind: 'question' | 'answer' | 'note';
  label: string;
  button: string;
  placeholder?: string;
}) {
  const [body, setBody] = useState('');
  const a = useAction();
  const id = `msg-${kind}`;
  const Icon = kind === 'note' ? StickyNote : Send;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        maxLength={2000}
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
      />
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className={kind === 'note' ? 'btn' : 'btn primary'}
          type="button"
          state={a.state}
          disabled={!body.trim()}
          onClick={() =>
            a.run(`/api/orders/${orderId}/messages`, { kind, body })
          }
        >
          <Icon className="icon" aria-hidden="true" />
          {button}
        </MorphButton>
      </div>
    </div>
  );
}

// Outline ---------------------------------------------------------------------------

export type CatalogPick = {
  id: string;
  source_id: string;
  name: string;
  sku: string | null;
  unit: string;
  tax_rate: TaxRate;
};

type Row = {
  key: string;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  tax_rate: TaxRate;
  item_id: string | null;
};

const newRow = (key: string, r: Partial<Row> = {}): Row => ({
  key,
  name: '',
  spec: '',
  qty: '1',
  unit: '個',
  tax_rate: 10,
  item_id: null,
  ...r,
});

export function OutlineEditor({
  orderId,
  lines,
  catalog,
  makers,
}: {
  orderId: string;
  lines: {
    name: string;
    spec: string;
    qty: number;
    unit: string;
    tax_rate: TaxRate;
    item_id: string | null;
  }[];
  catalog: CatalogPick[];
  makers: { name: string; source_id: string }[];
}) {
  // Row keys (and the ids built from them) must be the same on the server
  // and in the browser, so they count from the initial lines.
  const seq = useRef(Math.max(lines.length, 1));
  const nextKey = () => `r${seq.current++}`;
  const [rows, setRows] = useState<Row[]>(() =>
    lines.length
      ? lines.map((l, i) => newRow(`r${i}`, { ...l, qty: String(l.qty) }))
      : [newRow('r0')],
  );
  const [source, setSource] = useState(makers[0]?.source_id ?? '');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const a = useAction();
  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const parsed = rows.map((r) => ({ ...r, n: intOr(r.qty) }));
  const invalid = parsed.some(
    (r) => !r.name.trim() || !r.n || r.n < 1 || r.n > 9999,
  );
  const body = parsed.map((r) => ({
    name: r.name,
    spec: r.spec,
    qty: r.n,
    unit: r.unit,
    tax_rate: r.tax_rate,
    item_id: r.item_id,
  }));
  const found = catalog
    .filter((i) => i.source_id === source)
    .filter((i) => !q || i.name.includes(q) || (i.sku ?? '').includes(q))
    .slice(0, 30);

  const confirm = async () => {
    a.setError('');
    try {
      await send(`/api/orders/${orderId}/outline`, { lines: body }, 'PUT');
    } catch (e) {
      a.setError((e as Error).message);
      return;
    }
    await a.run(`/api/orders/${orderId}/outline/confirm`);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {parsed.map((r, i) => (
        <div key={r.key} className="line-grid">
          <div className="field">
            <label htmlFor={`${r.key}-name`}>品名 {i + 1}</label>
            <input
              id={`${r.key}-name`}
              maxLength={200}
              value={r.name}
              aria-invalid={!r.name.trim() || undefined}
              onChange={(e) => update(r.key, { name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${r.key}-spec`}>仕様（寸法・色など）</label>
            <input
              id={`${r.key}-spec`}
              maxLength={500}
              value={r.spec}
              onChange={(e) => update(r.key, { spec: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${r.key}-qty`}>数量</label>
            <input
              id={`${r.key}-qty`}
              inputMode="numeric"
              value={r.qty}
              aria-invalid={!r.n || r.n < 1 || undefined}
              onChange={(e) => update(r.key, { qty: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${r.key}-unit`}>単位</label>
            <input
              id={`${r.key}-unit`}
              maxLength={20}
              value={r.unit}
              onChange={(e) => update(r.key, { unit: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${r.key}-tax`}>税率</label>
            <select
              id={`${r.key}-tax`}
              value={r.tax_rate}
              onChange={(e) =>
                update(r.key, { tax_rate: Number(e.target.value) as TaxRate })
              }
            >
              <option value={10}>10%</option>
              <option value={8}>8%（軽減）</option>
            </select>
          </div>
          <button
            type="button"
            className="btn ghost"
            disabled={rows.length === 1}
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          >
            <Trash className="icon" aria-hidden="true" />
            <span className="sr-only">{i + 1}行目を</span>削除
          </button>
        </div>
      ))}
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => setRows((rs) => [...rs, newRow(nextKey())])}
        >
          <Plus className="icon" aria-hidden="true" />
          行を追加
        </button>
        {makers.length > 0 && (
          <button
            type="button"
            className="btn"
            aria-expanded={picking}
            onClick={() => setPicking((p) => !p)}
          >
            <ListPlus className="icon" aria-hidden="true" />
            カタログから選ぶ
          </button>
        )}
      </div>
      {picking && (
        <div className="mq" role="group" aria-label="カタログから選ぶ">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pick-maker">メーカー</label>
              <select
                id="pick-maker"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {makers.map((m) => (
                  <option key={m.source_id} value={m.source_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pick-q">品名・品番で絞り込む</label>
              <input
                id="pick-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <ul className="todo-list">
            {found.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ width: '100%', justifyContent: 'space-between' }}
                  onClick={() =>
                    setRows((rs) => [
                      ...rs.filter((x) => x.name.trim() || x.spec.trim()),
                      newRow(nextKey(), {
                        name: i.name,
                        unit: i.unit,
                        tax_rate: i.tax_rate,
                        item_id: i.id,
                      }),
                    ])
                  }
                >
                  <span>{i.name}</span>
                  <span className="meta-line">{i.sku}・追加</span>
                </button>
              </li>
            ))}
            {!found.length && (
              <li className="meta-line">該当する商品はありません。</li>
            )}
          </ul>
        </div>
      )}
      <ErrorLine message={a.error} />
      <div className="actions section">
        <MorphButton
          className="btn primary big"
          type="button"
          state={a.state}
          disabled={invalid}
          onClick={confirm}
        >
          <CircleCheck className="icon" aria-hidden="true" />
          商品概要を確定する
        </MorphButton>
        <button
          type="button"
          className="btn"
          disabled={invalid || a.state !== 'idle'}
          onClick={() =>
            a.run(
              `/api/orders/${orderId}/outline`,
              { lines: body },
              {
                method: 'PUT',
              },
            )
          }
        >
          <Save className="icon" aria-hidden="true" />
          下書きとして保存
        </button>
        {invalid && (
          <span className="meta-line" style={{ color: 'var(--error)' }}>
            品名と数量（1〜9999）をすべての行に入れてください。
          </span>
        )}
      </div>
    </div>
  );
}

export function OutlineReopen({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const a = useAction();
  if (!open)
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        <PenLine className="icon" aria-hidden="true" />
        商品概要を直す
      </button>
    );
  return (
    <div className="confirm-box">
      <b>商品概要を直しますか？</b>
      <span className="meta-line">
        回答待ち・受け取り済みのメーカーの見積は取り下げになります。直したあと、もう一度メーカーに見積を依頼します。
      </span>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn"
          type="button"
          state={a.state}
          onClick={() => a.run(`/api/orders/${orderId}/outline/reopen`)}
        >
          <PenLine className="icon" aria-hidden="true" />
          商品概要を直す
        </MorphButton>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setOpen(false)}
        >
          やめる
        </button>
      </div>
    </div>
  );
}

// Makers ----------------------------------------------------------------------------

export function MakerRequest({
  orderId,
  makers,
}: {
  orderId: string;
  makers: { id: string; name: string; busy: boolean }[];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const a = useAction();
  if (!makers.length)
    return (
      <p className="meta-line">
        見積を頼めるメーカーがありません。「メーカー」で登録してください。
      </p>
    );
  return (
    <fieldset
      style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}
    >
      <legend className="legend">見積を頼むメーカー（複数選ぶと相見積）</legend>
      <div className="radio-row">
        {makers.map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              className="check"
              disabled={m.busy}
              checked={picked.includes(m.id)}
              onChange={(e) =>
                setPicked((p) =>
                  e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id),
                )
              }
            />
            {m.name}
            {m.busy && <span className="meta-line">（依頼済み）</span>}
          </label>
        ))}
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary"
          type="button"
          state={a.state}
          disabled={!picked.length}
          onClick={() =>
            a.run(`/api/orders/${orderId}/maker-quotes`, { makerIds: picked })
          }
        >
          <Factory className="icon" aria-hidden="true" />
          {picked.length > 1
            ? `${picked.length}社に見積を依頼する`
            : '見積を依頼する'}
        </MorphButton>
        <span className="meta-line">
          メーカーには商品概要だけをメールで送ります（A社の名前や住所は送りません）。
        </span>
      </div>
    </fieldset>
  );
}

export function MakerQuoteActions({
  makerQuoteId,
  makerName,
  lines,
  today,
  defaultValid,
  canRecord,
}: {
  makerQuoteId: string;
  makerName: string;
  lines: { id: string; name: string; qty: number; unit: string }[];
  today: string;
  defaultValid: string;
  canRecord: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'record' | 'decline'>('idle');
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<Record<string, Stock>>({});
  const [shipping, setShipping] = useState('0');
  const [lead, setLead] = useState('');
  const [valid, setValid] = useState(defaultValid);
  const [note, setNote] = useState('');
  const a = useAction();
  const id = `mq-${makerQuoteId.slice(0, 8)}`;
  const parsedCosts = lines.map((l) => intOr(costs[l.id] ?? ''));
  const ship = intOr(shipping);
  const invalid =
    parsedCosts.some((c) => c === null) || ship === null || !valid;

  if (mode === 'idle')
    return (
      <div className="actions">
        {canRecord && (
          <button
            type="button"
            className="btn primary"
            onClick={() => setMode('record')}
          >
            <PenLine className="icon" aria-hidden="true" />
            受け取った見積を入力
          </button>
        )}
        <button
          type="button"
          className="btn ghost"
          onClick={() => setMode('decline')}
        >
          <Ban className="icon" aria-hidden="true" />
          辞退にする
        </button>
      </div>
    );
  if (mode === 'decline')
    return (
      <div className="field">
        <label htmlFor={`${id}-decline`}>辞退の理由（B社だけに見えます）</label>
        <textarea
          id={`${id}-decline`}
          maxLength={1000}
          value={note}
          placeholder="例：在庫がなく、納期に間に合わない"
          onChange={(e) => setNote(e.target.value)}
        />
        <ErrorLine message={a.error} />
        <div className="actions">
          <MorphButton
            className="btn danger"
            type="button"
            state={a.state}
            disabled={!note.trim()}
            onClick={() =>
              a.run(`/api/maker-quotes/${makerQuoteId}/decline`, { note })
            }
          >
            <Ban className="icon" aria-hidden="true" />
            辞退として記録する
          </MorphButton>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setMode('idle')}
          >
            戻る
          </button>
        </div>
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {lines.map((l, i) => (
        <div key={l.id} className="form-grid">
          <div className="field">
            <label htmlFor={`${id}-cost-${i}`}>
              {l.name}（{l.qty}
              {l.unit}）の原価・1{l.unit}あたり税抜
            </label>
            <input
              id={`${id}-cost-${i}`}
              inputMode="numeric"
              value={costs[l.id] ?? ''}
              aria-invalid={parsedCosts[i] === null || undefined}
              onChange={(e) =>
                setCosts((c) => ({ ...c, [l.id]: e.target.value }))
              }
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-stock-${i}`}>在庫</label>
            <select
              id={`${id}-stock-${i}`}
              value={stock[l.id] ?? 'in_stock'}
              onChange={(e) =>
                setStock((x) => ({ ...x, [l.id]: e.target.value as Stock }))
              }
            >
              {(Object.keys(stockLabels) as Stock[]).map((k) => (
                <option key={k} value={k}>
                  {stockLabels[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${id}-ship`}>メーカーの送料（税抜）</label>
          <input
            id={`${id}-ship`}
            inputMode="numeric"
            value={shipping}
            aria-invalid={ship === null || undefined}
            onChange={(e) => setShipping(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-lead`}>納期の目安</label>
          <input
            id={`${id}-lead`}
            maxLength={100}
            value={lead}
            placeholder="例：受注後10日"
            onChange={(e) => setLead(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-valid`}>メーカーの見積の有効期限</label>
          <input
            id={`${id}-valid`}
            type="date"
            min={today}
            value={valid}
            onChange={(e) => setValid(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-note`}>メモ（任意）</label>
          <input
            id={`${id}-note`}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary"
          type="button"
          state={a.state}
          disabled={invalid}
          onClick={() =>
            a.run(`/api/maker-quotes/${makerQuoteId}/record`, {
              lines: lines.map((l, i) => ({
                order_line_id: l.id,
                unit_cost: parsedCosts[i],
                stock: stock[l.id] ?? 'in_stock',
              })),
              shipping_cost: ship,
              lead_time: lead || null,
              valid_until: valid,
              note: note || null,
            })
          }
        >
          <Save className="icon" aria-hidden="true" />
          {makerName}の見積を記録する
        </MorphButton>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setMode('idle')}
        >
          戻る
        </button>
      </div>
    </div>
  );
}

// Quote to A社 ----------------------------------------------------------------------

export type BuilderMakerQuote = {
  id: string;
  maker_name: string;
  shipping_cost: number;
  cost_subtotal: number;
  lead_time: string | null;
  costs: Record<string, number>;
};

export function QuoteBuilder({
  orderId,
  lines,
  makerQuotes,
  initial,
  today,
  defaultValid,
  requote,
}: {
  orderId: string;
  lines: {
    id: string;
    name: string;
    spec: string;
    qty: number;
    unit: string;
    tax_rate: TaxRate;
  }[];
  makerQuotes: BuilderMakerQuote[];
  initial: {
    maker_quote_id: string;
    mode: 'markup' | 'price';
    markup_bp: number | null;
    prices: Record<string, number>;
    shipping_fee: number;
    expenses: number;
  } | null;
  today: string;
  defaultValid: string;
  requote: boolean;
}) {
  const cheapest = [...makerQuotes].sort(
    (x, y) => x.cost_subtotal - y.cost_subtotal,
  )[0];
  const [mqId, setMqId] = useState(
    initial?.maker_quote_id ?? cheapest?.id ?? '',
  );
  const mq = makerQuotes.find((m) => m.id === mqId) ?? cheapest;
  const [mode, setMode] = useState<'markup' | 'price'>(
    initial?.mode ?? 'markup',
  );
  const [pct, setPct] = useState(
    String(initial?.markup_bp != null ? initial.markup_bp / 100 : 20),
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial?.prices ?? {}).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [shipping, setShipping] = useState(
    String(initial?.shipping_fee ?? mq?.shipping_cost ?? 0),
  );
  const [expenses, setExpenses] = useState(String(initial?.expenses ?? 0));
  const [valid, setValid] = useState(defaultValid);
  const [note, setNote] = useState('');
  const a = useAction();

  const pctNum = Number(pct.normalize('NFKC'));
  const bp = Number.isFinite(pctNum) ? Math.round(pctNum * 100) : NaN;
  const bpOk =
    Number.isInteger(bp) && bp >= 0 && bp <= MAX_MARKUP_BP && pct.trim() !== '';
  const ship = parseYen(shipping);
  const exp = parseYen(expenses);
  const priced = useMemo(
    () =>
      lines.map((l) => {
        const cost = mq?.costs[l.id] ?? 0;
        const price =
          mode === 'markup'
            ? bpOk
              ? sellingPrice(cost, bp)
              : null
            : parseYen(prices[l.id] ?? '');
        return { ...l, cost, price };
      }),
    [lines, mq, mode, bp, bpOk, prices],
  );
  const invalid =
    !mq ||
    ship === null ||
    exp === null ||
    !valid ||
    priced.some((l) => l.price === null);
  const totals = quoteTotals(
    priced.map((l) => ({
      unitPrice: l.price ?? 0,
      qty: l.qty,
      taxRate: l.tax_rate,
    })),
    ship ?? 0,
    exp ?? 0,
  );
  const sales =
    priced.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0) +
    (ship ?? 0) +
    (exp ?? 0);
  const profit = quoteProfit(mq?.cost_subtotal ?? 0, sales);

  if (!mq)
    return (
      <p className="meta-line">
        メーカーの見積を記録すると、見積書を作れます。
      </p>
    );
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="qb-mq">もとにするメーカーの見積</label>
          <select
            id="qb-mq"
            value={mqId}
            onChange={(e) => setMqId(e.target.value)}
          >
            {makerQuotes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.maker_name}（原価計 {yen(m.cost_subtotal)}
                {m.id === cheapest?.id ? '・最安' : ''}）
              </option>
            ))}
          </select>
        </div>
        <fieldset
          className="field"
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <legend className="legend">利益の載せ方</legend>
          <div className="radio-row">
            <label>
              <input
                type="radio"
                name="qb-mode"
                checked={mode === 'markup'}
                onChange={() => setMode('markup')}
              />
              原価に率を載せる
            </label>
            <label>
              <input
                type="radio"
                name="qb-mode"
                checked={mode === 'price'}
                onChange={() => setMode('price')}
              />
              売値を入力
            </label>
          </div>
        </fieldset>
        {mode === 'markup' && (
          <div className="field">
            <label htmlFor="qb-pct">利益率（原価に対して％・0.1刻み）</label>
            <input
              id="qb-pct"
              type="number"
              step={0.1}
              min={0}
              max={MAX_MARKUP_BP / 100}
              value={pct}
              aria-invalid={!bpOk || undefined}
              onChange={(e) => setPct(e.target.value)}
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="qb-ship">A社に請求する送料（税抜）</label>
          <input
            id="qb-ship"
            inputMode="numeric"
            value={shipping}
            aria-invalid={ship === null || undefined}
            onChange={(e) => setShipping(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="qb-exp">諸経費（税抜）</label>
          <input
            id="qb-exp"
            inputMode="numeric"
            value={expenses}
            aria-invalid={exp === null || undefined}
            onChange={(e) => setExpenses(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="qb-valid">見積書の有効期限</label>
          <input
            id="qb-valid"
            type="date"
            min={today}
            value={valid}
            onChange={(e) => setValid(e.target.value)}
          />
        </div>
        <div className="field wide">
          <label htmlFor="qb-note">A社へのメモ（任意・見積書に載ります）</label>
          <textarea
            id="qb-note"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <ScrollX label="見積書のプレビュー">
        <table className="list lines">
          <caption className="sr-only">見積書のプレビュー</caption>
          <thead>
            <tr>
              <th>品名</th>
              <th className="num">原価（B社だけ）</th>
              <th className="num">売値（税抜）</th>
              <th className="num">数量</th>
              <th className="num">金額</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((l) => (
              <tr key={l.id}>
                <td className="name">
                  {l.name}
                  {l.spec && (
                    <span className="meta-line" style={{ display: 'block' }}>
                      {l.spec}
                    </span>
                  )}
                </td>
                <td className="num">{yen(l.cost)}</td>
                <td className="num">
                  {mode === 'price' ? (
                    <input
                      inputMode="numeric"
                      aria-label={`${l.name}の売値（税抜）`}
                      value={prices[l.id] ?? ''}
                      aria-invalid={l.price === null || undefined}
                      onChange={(e) =>
                        setPrices((p) => ({ ...p, [l.id]: e.target.value }))
                      }
                      style={{ width: 120 }}
                    />
                  ) : (
                    yen(l.price)
                  )}
                </td>
                <td className="num">
                  {l.qty}
                  {l.unit}
                </td>
                <td className="num">
                  <b>{l.price !== null ? yen(l.price * l.qty) : '—'}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <Totals
        totals={totals}
        shippingFee={ship ?? 0}
        expenses={exp ?? 0}
        label="見積書の合計（税込）"
      />
      <div className="agent-box" aria-label="原価と利益（B社だけに見えます）">
        <span className="agent-only">B社だけに見えます</span>
        <dl className="kv num" style={{ margin: 0 }}>
          <dt>原価計（メーカーの送料込み・税抜）</dt>
          <dd>{yen(mq.cost_subtotal)}</dd>
          <dt>売上計（税抜）</dt>
          <dd>{yen(sales)}</dd>
          <dt>利益</dt>
          <dd style={profit < 0 ? { color: 'var(--error)' } : undefined}>
            {yen(profit)}
            {sales > 0 && `（売上の${((profit / sales) * 100).toFixed(1)}%）`}
            {profit < 0 && ' 赤字です'}
          </dd>
        </dl>
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary big"
          type="button"
          state={a.state}
          disabled={invalid}
          onClick={() =>
            a.run(`/api/orders/${orderId}/quote`, {
              maker_quote_id: mq.id,
              mode,
              markup_bp: mode === 'markup' ? bp : null,
              prices:
                mode === 'price'
                  ? priced.map((l) => ({
                      order_line_id: l.id,
                      unit_price: l.price,
                    }))
                  : null,
              shipping_fee: ship,
              expenses: exp,
              valid_until: valid,
              note: note || null,
            })
          }
        >
          <Send className="icon" aria-hidden="true" />
          {requote ? '新しい見積書をA社に送る' : '見積書をA社に送る'}（
          {yen(totals.total)}）
        </MorphButton>
        <span className="meta-line">
          A社には売値・送料・諸経費・税額・合計だけが届きます。金額はデータベースが計算し直します。
        </span>
      </div>
    </div>
  );
}

export function ClientQuoteResponse({
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
  const a = useAction();
  return (
    <div className="section" style={{ display: 'grid', gap: 12 }}>
      {mode === 'idle' && (
        <div className="actions">
          <button
            className="btn primary big"
            type="button"
            disabled={expired}
            onClick={() => setMode('accept')}
          >
            <CircleCheck className="icon" aria-hidden="true" />
            合意する
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setMode('revise')}
          >
            <PenLine className="icon" aria-hidden="true" />
            修正を頼む
          </button>
          <button
            className="btn danger ghost"
            type="button"
            onClick={() => setMode('cancel')}
          >
            <Undo2 className="icon" aria-hidden="true" />
            取り下げる
          </button>
          {expired && (
            <span className="meta-line" style={{ color: 'var(--error)' }}>
              有効期限が切れています。修正を頼んで、新しい見積書を受け取ってください。
            </span>
          )}
        </div>
      )}
      {mode === 'accept' && (
        <div className="confirm-box" role="group" aria-label="合意の確認">
          <b className="num">合計 {yen(total)}（税込）で合意します。</b>
          <span className="meta-line">
            合意すると、B社がメーカーに発注します。納期が決まったら「通知」でお知らせします。
          </span>
          <div className="actions">
            <MorphButton
              className="btn primary big"
              type="button"
              state={a.state}
              onClick={() =>
                a.run(`/api/orders/${orderId}/accept`, { quoteId })
              }
            >
              <CircleCheck className="icon" aria-hidden="true" />
              この見積書で合意する
            </MorphButton>
            <button
              className="btn ghost"
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
              ? '修正してほしい内容（B社に届きます）'
              : '取り下げの理由（任意・B社に届きます）'}
          </label>
          <textarea
            id="response-text"
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'revise' ? '例：予算を5万円以内にしたいです。' : ''
            }
          />
          <div className="actions">
            <MorphButton
              className={mode === 'revise' ? 'btn primary' : 'btn danger'}
              type="button"
              state={a.state}
              disabled={mode === 'revise' && !text.trim()}
              onClick={() =>
                mode === 'revise'
                  ? a.run(`/api/orders/${orderId}/revision`, {
                      quoteId,
                      note: text,
                    })
                  : a.run(`/api/orders/${orderId}/cancel`, {
                      reason: text || null,
                    })
              }
            >
              {mode === 'revise' ? (
                <PenLine className="icon" aria-hidden="true" />
              ) : (
                <Undo2 className="icon" aria-hidden="true" />
              )}
              {mode === 'revise' ? '修正を頼む' : '依頼を取り下げる'}
            </MorphButton>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMode('idle')}
            >
              戻る
            </button>
          </div>
        </div>
      )}
      <ErrorLine message={a.error} />
    </div>
  );
}

// Ordering and the delivery date ----------------------------------------------------

export function PlaceOrderForm({
  orderId,
  destinations,
  makerName,
}: {
  orderId: string;
  destinations: Record<DeliveryMode, string>;
  makerName: string | null;
}) {
  const [mode, setMode] = useState<DeliveryMode>('direct');
  const [note, setNote] = useState('');
  const a = useAction();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="legend">届き方</legend>
        <div className="radio-row">
          {(['direct', 'via_agent'] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="delivery-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {deliveryModeLabels[m]}
            </label>
          ))}
        </div>
        <span className="meta-line">
          届け先：{destinations[mode] || '住所が未登録です'}
        </span>
      </fieldset>
      <div className="field">
        <label htmlFor="po-note">
          発注メモ（任意・メーカーへの発注書に載ります）
        </label>
        <textarea
          id="po-note"
          maxLength={500}
          value={note}
          placeholder="例：平日8時までに搬入してください。"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary big"
          type="button"
          state={a.state}
          onClick={() =>
            a.run(`/api/orders/${orderId}/place`, {
              delivery_mode: mode,
              delivery_note: note || null,
            })
          }
        >
          <Truck className="icon" aria-hidden="true" />
          メーカーに発注する
        </MorphButton>
        <span className="meta-line">
          {makerName ? `${makerName}に` : 'メーカーに'}
          発注番号つきの発注書をメールで送ります。
        </span>
      </div>
    </div>
  );
}

export function ScheduleForm({
  orderId,
  today,
}: {
  orderId: string;
  today: string;
}) {
  const [date, setDate] = useState('');
  const a = useAction();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="delivery-date">納期（メーカーに確認した日）</label>
        <input
          id="delivery-date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary big"
          type="button"
          state={a.state}
          disabled={!date}
          onClick={() =>
            a.run(`/api/orders/${orderId}/schedule`, { delivery_date: date })
          }
        >
          <CalendarCheck className="icon" aria-hidden="true" />
          納期を確定してA社に知らせる
        </MorphButton>
        <span className="meta-line">
          依頼した拠点の担当者に「納期のお知らせ」メールが届きます。
        </span>
      </div>
    </div>
  );
}

// Refusing and withdrawing ----------------------------------------------------------

export function RejectForm({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const a = useAction();
  if (!open)
    return (
      <button
        className="btn danger ghost"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Ban className="icon" aria-hidden="true" />
        この依頼をお断りする
      </button>
    );
  return (
    <div className="field">
      <label htmlFor="reject-reason">お断りの理由（A社に届きます）</label>
      <textarea
        id="reject-reason"
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn danger"
          type="button"
          state={a.state}
          disabled={!reason.trim()}
          onClick={() => a.run(`/api/orders/${orderId}/reject`, { reason })}
        >
          <Ban className="icon" aria-hidden="true" />
          お断りする
        </MorphButton>
        <button
          className="btn ghost"
          type="button"
          onClick={() => setOpen(false)}
        >
          やめる
        </button>
      </div>
    </div>
  );
}

export function CancelRequest({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const a = useAction();
  if (!open)
    return (
      <button
        className="btn danger ghost"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Undo2 className="icon" aria-hidden="true" />
        依頼を取り下げる
      </button>
    );
  return (
    <div className="field">
      <label htmlFor="cancel-reason">
        取り下げの理由（任意・B社に届きます）
      </label>
      <textarea
        id="cancel-reason"
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn danger"
          type="button"
          state={a.state}
          onClick={() =>
            a.run(`/api/orders/${orderId}/cancel`, { reason: reason || null })
          }
        >
          <Undo2 className="icon" aria-hidden="true" />
          取り下げる
        </MorphButton>
        <button
          className="btn ghost"
          type="button"
          onClick={() => setOpen(false)}
        >
          戻る
        </button>
      </div>
    </div>
  );
}
