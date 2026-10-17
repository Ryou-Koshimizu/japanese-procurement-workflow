'use client';
import { useState } from 'react';
import { PenLine, Plus, Save } from 'lucide-react';
import type { Maker } from '../../../src/server/service';
import { ErrorLine, useAction } from '../../../src/ui/form';
import { MorphButton } from '../../../src/ui/morph';

type Draft = {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  note: string;
  catalog_source_id: string;
  active: boolean;
};

const empty: Draft = {
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  note: '',
  catalog_source_id: '',
  active: true,
};

function MakerForm({
  initial,
  sources,
  url,
  method,
  button,
  onCancel,
}: {
  initial: Draft;
  sources: { id: string; name: string }[];
  url: string;
  method: 'POST' | 'PATCH';
  button: string;
  onCancel?: () => void;
}) {
  const [d, setD] = useState(initial);
  const a = useAction();
  const p = url.replace(/\W/g, '').slice(-8);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value });
  const err = (k: string) => a.fields[k];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${p}-name`}>
            名前<span className="req-mark">（必須）</span>
          </label>
          <input
            id={`${p}-name`}
            maxLength={100}
            value={d.name}
            onChange={set('name')}
            aria-invalid={!!err('name') || undefined}
          />
          {err('name') && <span className="field-error">{err('name')}</span>}
        </div>
        <div className="field">
          <label htmlFor={`${p}-email`}>
            見積・発注を送るメール<span className="req-mark">（必須）</span>
          </label>
          <input
            id={`${p}-email`}
            type="email"
            maxLength={200}
            value={d.email}
            onChange={set('email')}
            aria-invalid={!!err('email') || undefined}
          />
          {err('email') && <span className="field-error">{err('email')}</span>}
        </div>
        <div className="field">
          <label htmlFor={`${p}-contact`}>担当者</label>
          <input
            id={`${p}-contact`}
            maxLength={100}
            value={d.contact_name}
            onChange={set('contact_name')}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p}-phone`}>電話</label>
          <input
            id={`${p}-phone`}
            type="tel"
            maxLength={30}
            value={d.phone}
            onChange={set('phone')}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p}-catalog`}>カタログ</label>
          <select
            id={`${p}-catalog`}
            value={d.catalog_source_id}
            onChange={set('catalog_source_id')}
          >
            <option value="">なし</option>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="legend">使う・使わない</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={d.active}
              onChange={(e) => setD({ ...d, active: e.target.checked })}
            />
            見積を頼めるメーカーにする
          </label>
        </div>
        <div className="field wide">
          <label htmlFor={`${p}-note`}>メモ（B社だけに見えます）</label>
          <textarea
            id={`${p}-note`}
            maxLength={1000}
            value={d.note}
            onChange={set('note')}
          />
        </div>
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary"
          type="button"
          state={a.state}
          disabled={!d.name.trim() || !d.email.trim()}
          onClick={() => a.run(url, d, { method })}
        >
          {method === 'POST' ? (
            <Plus className="icon" aria-hidden="true" />
          ) : (
            <Save className="icon" aria-hidden="true" />
          )}
          {button}
        </MorphButton>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            やめる
          </button>
        )}
      </div>
    </div>
  );
}

export default function MakersEditor({
  makers,
  sources,
}: {
  makers: Maker[];
  sources: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="mq-cards">
        {makers.map((m) => (
          <article
            key={m.id}
            className="card pad"
            style={{ display: 'grid', gap: 8 }}
          >
            {editing === m.id ? (
              <MakerForm
                initial={{
                  name: m.name,
                  contact_name: m.contact_name ?? '',
                  email: m.email,
                  phone: m.phone ?? '',
                  note: m.note ?? '',
                  catalog_source_id: m.catalog_source_id ?? '',
                  active: m.active,
                }}
                sources={sources}
                url={`/api/makers/${m.id}`}
                method="PATCH"
                button="変更を保存"
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <h2 style={{ margin: 0 }}>
                  {m.name}
                  {!m.active && (
                    <span className="meta-line">（使っていません）</span>
                  )}
                </h2>
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>メール</dt>
                  <dd>{m.email}</dd>
                  <dt>担当者</dt>
                  <dd>{m.contact_name ?? '—'}</dd>
                  <dt>電話</dt>
                  <dd>{m.phone ?? '—'}</dd>
                  <dt>カタログ</dt>
                  <dd>{m.catalog_name ?? 'なし'}</dd>
                </dl>
                {m.note && (
                  <p className="meta-line" style={{ margin: 0 }}>
                    {m.note}
                  </p>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditing(m.id)}
                  >
                    <PenLine className="icon" aria-hidden="true" />
                    <span className="sr-only">{m.name}を</span>編集
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      <section className="card pad" aria-labelledby="new-maker">
        <h2 id="new-maker">
          <Plus className="icon" aria-hidden="true" />
          メーカーを追加
        </h2>
        <MakerForm
          initial={empty}
          sources={sources}
          url="/api/makers"
          method="POST"
          button="メーカーを追加"
        />
      </section>
    </div>
  );
}
