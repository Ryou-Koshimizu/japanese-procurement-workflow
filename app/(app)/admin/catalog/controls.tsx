'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  CatalogItem,
  ImportSummary,
  Source,
} from '../../../../src/server/service';
import { yen, formatDateTime } from '../../../../src/ui/format';
import {
  FileSpreadsheet,
  Globe,
  LoaderCircle,
  PenLine,
  Plus,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';

async function send(
  url: string,
  method: string,
  body?: unknown,
  raw?: BodyInit,
) {
  const r = await fetch(url, {
    method,
    headers: raw
      ? { 'Content-Type': 'text/csv' }
      : body
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? '保存できませんでした。');
  return json;
}

function ImportResult({ r }: { r: ImportSummary }) {
  return (
    <div className="source">
      <div className="result-grid num">
        {r.pages !== undefined && (
          <span>
            読んだページ <b>{r.pages}</b>
          </span>
        )}
        <span>
          商品 <b>{r.found}</b>件
        </span>
        <span>
          新規 <b>{r.created}</b>
        </span>
        <span>
          変更 <b>{r.updated}</b>
        </span>
        <span>
          変更なし <b>{r.unchanged}</b>
        </span>
        <span>
          載らなくなった <b>{r.missing}</b>
        </span>
        <span>
          画像 <b>{r.images}</b>
        </span>
      </div>
      {r.stoppedEarly && (
        <p className="notice" style={{ margin: 0 }}>
          {r.stoppedEarly}
        </p>
      )}
      {r.errors.length > 0 && (
        <details>
          <summary
            className="meta-line"
            style={{ color: 'var(--error)', cursor: 'pointer' }}
          >
            読み込めなかったページ {r.errors.length}件
          </summary>
          <ul className="meta-line">
            {r.errors.map((e, i) => (
              <li key={i}>
                {e.url}：{e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.skipped.length > 0 && (
        <details>
          <summary className="meta-line" style={{ cursor: 'pointer' }}>
            取り込まなかった商品 {r.skipped.length}件
          </summary>
          <ul className="meta-line">
            {r.skipped.map((x, i) => (
              <li key={i}>
                {x.name ?? x.where}：{x.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type FormState = {
  name: string;
  kind: 'site' | 'csv';
  urls: string;
  pricesIncludeTax: boolean;
  defaultTaxRate: 8 | 10;
};

function SourceForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  lockKind,
}: {
  initial: FormState;
  submitLabel: string;
  onSubmit: (f: FormState) => Promise<void>;
  onCancel?: () => void;
  lockKind?: boolean;
}) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idp = initial.name ? 'edit' : 'new';
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await onSubmit(f);
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor={`${idp}-name`}>カタログの名前</label>
        <input
          id={`${idp}-name`}
          type="text"
          required
          maxLength={100}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </div>
      <fieldset
        className="field"
        style={{ border: 0, padding: 0, margin: 0 }}
        disabled={lockKind}
      >
        <legend
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink-2)',
            marginBottom: 5,
          }}
        >
          取り込み方法
        </legend>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              name={`${idp}-kind`}
              checked={f.kind === 'site'}
              onChange={() => setF({ ...f, kind: 'site' })}
            />
            サイトのURL
          </label>
          <label>
            <input
              type="radio"
              name={`${idp}-kind`}
              checked={f.kind === 'csv'}
              onChange={() => setF({ ...f, kind: 'csv' })}
            />
            CSVファイル
          </label>
        </div>
      </fieldset>
      {f.kind === 'site' && (
        <div className="field wide">
          <label htmlFor={`${idp}-urls`}>
            商品一覧・商品ページのURL（1行に1つ、20件まで）
          </label>
          <textarea
            id={`${idp}-urls`}
            required
            value={f.urls}
            onChange={(e) => setF({ ...f, urls: e.target.value })}
            placeholder="https://example.com/catalog/"
          />
          <span className="meta-line">
            一覧ページに商品リスト（ItemList）があれば、同じサイトの商品ページを最大60ページまでたどります。robots.txt
            で禁止されたページは読みません。
          </span>
        </div>
      )}
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink-2)',
            marginBottom: 5,
          }}
        >
          サイトの価格の表示
        </legend>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              name={`${idp}-tax`}
              checked={f.pricesIncludeTax}
              onChange={() => setF({ ...f, pricesIncludeTax: true })}
            />
            税込
          </label>
          <label>
            <input
              type="radio"
              name={`${idp}-tax`}
              checked={!f.pricesIncludeTax}
              onChange={() => setF({ ...f, pricesIncludeTax: false })}
            />
            税抜
          </label>
        </div>
        <span className="meta-line">
          ページに税込・税抜の記載（valueAddedTaxIncluded）があればそちらを優先します。
        </span>
      </fieldset>
      <div className="field">
        <label htmlFor={`${idp}-rate`}>標準の税率</label>
        <select
          id={`${idp}-rate`}
          value={f.defaultTaxRate}
          onChange={(e) =>
            setF({ ...f, defaultTaxRate: Number(e.target.value) as 8 | 10 })
          }
        >
          <option value={10}>10%</option>
          <option value={8}>8%（軽減税率）</option>
        </select>
        <span className="meta-line">
          「軽減税率」と書かれた商品は8%で取り込みます。
        </span>
      </div>
      {error && (
        <div className="alert field wide" role="alert">
          <TriangleAlert className="icon" aria-hidden="true" />
          {error}
        </div>
      )}
      <div className="actions field wide">
        <button className="btn primary" type="submit" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel}>
            やめる
          </button>
        )}
      </div>
    </form>
  );
}

const toBody = (f: FormState) => ({
  name: f.name,
  kind: f.kind,
  urls: f.urls.split(/\s+/).filter(Boolean),
  pricesIncludeTax: f.pricesIncludeTax,
  defaultTaxRate: f.defaultTaxRate,
});

export function SourceCard({
  source,
  viewUrl,
}: {
  source: Source;
  viewUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportSummary | null>(
    source.last_import,
  );

  async function runImport(file?: File) {
    setBusy(true);
    setError('');
    try {
      const r = file
        ? await send(
            `/api/catalog/sources/${source.id}/csv`,
            'POST',
            undefined,
            file,
          )
        : await send(`/api/catalog/sources/${source.id}/import`, 'POST', {});
      setResult(r.summary);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="card pad source" aria-labelledby={`src-${source.id}`}>
      <div className="quote-head" style={{ marginBottom: 0 }}>
        <h2 id={`src-${source.id}`} style={{ margin: 0 }}>
          {source.name}
        </h2>
        <span className="meta-line">
          掲載 {source.listed} / 取り込み {source.items}件・発注できる商品{' '}
          {source.orderable}件
        </span>
      </div>
      {editing ? (
        <SourceForm
          lockKind
          initial={{
            name: source.name,
            kind: source.kind,
            urls: source.urls.join('\n'),
            pricesIncludeTax: source.prices_include_tax,
            defaultTaxRate: source.default_tax_rate,
          }}
          submitLabel="保存する"
          onCancel={() => setEditing(false)}
          onSubmit={async (f) => {
            await send(`/api/catalog/sources/${source.id}`, 'PATCH', toBody(f));
            setEditing(false);
            router.refresh();
          }}
        />
      ) : (
        <dl className="kv">
          <dt>取り込み方法</dt>
          <dd>{source.kind === 'site' ? 'サイトのURL' : 'CSVファイル'}</dd>
          {source.kind === 'site' && (
            <>
              <dt>URL</dt>
              <dd>
                {source.urls.map((u) => (
                  <span key={u} style={{ display: 'block' }}>
                    {u}
                  </span>
                ))}
                {viewUrl && viewUrl !== source.urls[0] && (
                  <a href={viewUrl} target="_blank" rel="noreferrer noopener">
                    デモのメーカーのサイトを開く
                  </a>
                )}
              </dd>
            </>
          )}
          <dt>価格の表示</dt>
          <dd>
            {source.prices_include_tax ? '税込' : '税抜'}・標準税率{' '}
            {source.default_tax_rate}%
          </dd>
          <dt>最後の取り込み</dt>
          <dd>
            {source.imported_at
              ? formatDateTime(source.imported_at)
              : 'まだありません'}
          </dd>
        </dl>
      )}
      {result && <ImportResult r={result} />}
      {error && (
        <div className="alert" role="alert">
          <TriangleAlert className="icon" aria-hidden="true" />
          {error}
        </div>
      )}
      {!editing && (
        <div className="actions">
          {source.kind === 'site' ? (
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => runImport()}
            >
              {busy ? (
                <LoaderCircle className="icon spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="icon" aria-hidden="true" />
              )}
              {busy ? '読み込み中…（最大90秒）' : 'サイトから取り込む'}
            </button>
          ) : (
            <label
              className="btn primary"
              style={{ cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? (
                <LoaderCircle className="icon spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet className="icon" aria-hidden="true" />
              )}
              {busy ? '取り込み中…' : 'CSVを選んで取り込む'}
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) runImport(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => setEditing(true)}
          >
            <PenLine className="icon" aria-hidden="true" />
            設定を編集
          </button>
        </div>
      )}
    </section>
  );
}

export function NewSource({
  demo,
  demoUrl,
}: {
  demo: boolean;
  demoUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          <Plus className="icon" aria-hidden="true" />
          カタログを追加
        </button>
      </div>
    );
  return (
    <section className="card pad" aria-labelledby="new-source">
      <h2 id="new-source">
        <Globe className="icon" aria-hidden="true" />
        カタログを追加
      </h2>
      <SourceForm
        initial={{
          name: '',
          kind: 'site',
          urls: demo ? demoUrl : '',
          pricesIncludeTax: true,
          defaultTaxRate: 10,
        }}
        submitLabel="登録する"
        onCancel={() => setOpen(false)}
        onSubmit={async (f) => {
          await send('/api/catalog/sources', 'POST', toBody(f));
          setOpen(false);
          router.refresh();
        }}
      />
    </section>
  );
}

export function ItemRow({
  item,
  productUrl,
}: {
  item: CatalogItem;
  productUrl: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [unit, setUnit] = useState(item.unit);
  const patch = async (body: Record<string, unknown>) => {
    setError('');
    try {
      await send(`/api/catalog/items/${item.id}`, 'PATCH', body);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <tr>
      <td>
        <div className="item-cell">
          {item.image_id ? (
            <img
              className="thumb"
              src={`/api/catalog/images/${item.image_id}`}
              alt=""
              width={44}
              height={44}
            />
          ) : (
            <span className="thumb" aria-hidden="true" />
          )}
          <span>
            {productUrl ? (
              <a href={productUrl} target="_blank" rel="noreferrer noopener">
                {item.name}
              </a>
            ) : (
              item.name
            )}
            <span className="meta-line" style={{ display: 'block' }}>
              {[item.sku, item.category, item.source_name]
                .filter(Boolean)
                .join('・')}
            </span>
            {error && (
              <span
                className="meta-line"
                role="alert"
                style={{ color: 'var(--error)', display: 'block' }}
              >
                {error}
              </span>
            )}
          </span>
        </div>
      </td>
      <td className="num">
        {yen(item.listed_price)}
        <span className="meta-line" style={{ display: 'block' }}>
          {item.price_includes_tax ? '税込' : '税抜'}
        </span>
      </td>
      <td className="num">{yen(item.unit_price)}</td>
      <td>
        <select
          aria-label={`${item.name}の税率`}
          value={item.tax_rate}
          onChange={(e) => patch({ taxRate: Number(e.target.value) })}
          style={{ minWidth: 92 }}
        >
          <option value={10}>10%</option>
          <option value={8}>8%</option>
        </select>
      </td>
      <td>
        <input
          type="text"
          aria-label={`${item.name}の単位`}
          value={unit}
          maxLength={20}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={() =>
            unit.trim() && unit !== item.unit && patch({ unit: unit.trim() })
          }
          style={{ width: 80 }}
        />
      </td>
      <td>
        {item.available ? (
          <span className="tag">取り扱い中</span>
        ) : (
          <span className="tag off">在庫切れ・掲載なし</span>
        )}
      </td>
      <td>
        <label className="toggle">
          <input
            type="checkbox"
            checked={item.active}
            onChange={(e) => patch({ active: e.target.checked })}
            aria-label={`${item.name}を使う`}
          />
          {item.active ? '表示' : '非表示'}
        </label>
      </td>
    </tr>
  );
}
