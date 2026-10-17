'use client';
import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  PenLine,
  Plus,
  Save,
} from 'lucide-react';
import {
  FIELD_KINDS,
  fieldKindLabels,
  type FieldKind,
  type RequestField,
} from '../../../../src/core/intake';
import { ErrorLine, send, useAction } from '../../../../src/ui/form';
import { IntakeField } from '../../../../src/ui/intake-field';
import { MorphButton } from '../../../../src/ui/morph';

type Field = RequestField & { id: string };
type Draft = {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string;
  help: string;
  active: boolean;
};

function FieldForm({
  initial,
  isNew,
  onCancel,
  url,
}: {
  initial: Draft;
  isNew: boolean;
  onCancel?: () => void;
  url: string;
}) {
  const [d, setD] = useState(initial);
  const a = useAction();
  const p = isNew ? 'new' : initial.key;
  const err = (k: string) => a.fields[k];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${p}-label`}>項目名</label>
          <input
            id={`${p}-label`}
            maxLength={60}
            value={d.label}
            onChange={(e) => setD({ ...d, label: e.target.value })}
            aria-invalid={!!err('label') || undefined}
          />
          {err('label') && <span className="field-error">{err('label')}</span>}
        </div>
        {isNew && (
          <div className="field">
            <label htmlFor={`${p}-key`}>
              キー（半角英小文字・あとから変えられません）
            </label>
            <input
              id={`${p}-key`}
              maxLength={40}
              value={d.key}
              placeholder="例：color"
              onChange={(e) => setD({ ...d, key: e.target.value })}
              aria-invalid={!!err('key') || undefined}
            />
            {err('key') && <span className="field-error">{err('key')}</span>}
          </div>
        )}
        <div className="field">
          <label htmlFor={`${p}-kind`}>種類</label>
          <select
            id={`${p}-kind`}
            value={d.kind}
            onChange={(e) => setD({ ...d, kind: e.target.value as FieldKind })}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {fieldKindLabels[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="legend">入力</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={d.required}
              onChange={(e) => setD({ ...d, required: e.target.checked })}
            />
            必須にする
          </label>
        </div>
        {d.kind === 'choice' && (
          <div className="field wide">
            <label htmlFor={`${p}-options`}>選択肢（1行に1つ・20個まで）</label>
            <textarea
              id={`${p}-options`}
              value={d.options}
              onChange={(e) => setD({ ...d, options: e.target.value })}
              aria-invalid={!!err('options') || undefined}
            />
            {err('options') && (
              <span className="field-error">{err('options')}</span>
            )}
          </div>
        )}
        <div className="field wide">
          <label htmlFor={`${p}-help`}>
            説明（入力欄の下に出ます・200文字まで）
          </label>
          <input
            id={`${p}-help`}
            maxLength={200}
            value={d.help}
            onChange={(e) => setD({ ...d, help: e.target.value })}
          />
        </div>
      </div>
      <ErrorLine message={a.error} />
      <div className="actions">
        <MorphButton
          className="btn primary"
          type="button"
          state={a.state}
          disabled={!d.label.trim() || (isNew && !d.key.trim())}
          onClick={() =>
            a.run(
              url,
              {
                ...d,
                options: d.options
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
              { method: isNew ? 'POST' : 'PATCH' },
            )
          }
        >
          {isNew ? (
            <Plus className="icon" aria-hidden="true" />
          ) : (
            <Save className="icon" aria-hidden="true" />
          )}
          {isNew ? '項目を追加' : '変更を保存'}
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

export default function FieldsEditor({ fields }: { fields: Field[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const act = async (url: string, body: unknown, method = 'POST') => {
    setError('');
    try {
      await send(url, body, method);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const toDraft = (f: Field): Draft => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    required: f.required,
    options: f.options.join('\n'),
    help: f.help,
    active: f.active,
  });
  return (
    <div className="order-layout">
      <div className="stack">
        <section className="card pad" aria-labelledby="fields-heading">
          <h2 id="fields-heading">項目（{fields.length}）</h2>
          <ErrorLine message={error} />
          <ul className="thread">
            {fields.map((f, i) => (
              <li key={f.id} className="msg">
                {editing === f.id ? (
                  <FieldForm
                    initial={toDraft(f)}
                    isNew={false}
                    url={`/api/request-fields/${f.id}`}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <b>
                      {f.label}
                      {!f.active && (
                        <span className="meta-line">（使っていません）</span>
                      )}
                    </b>
                    <span className="meta-line">
                      {fieldKindLabels[f.kind]}・{f.required ? '必須' : '任意'}
                      ・キー {f.key}
                      {f.kind === 'choice'
                        ? `・選択肢 ${f.options.join('／')}`
                        : ''}
                    </span>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={i === 0}
                        onClick={() =>
                          act(`/api/request-fields/${f.id}/move`, { dir: 'up' })
                        }
                      >
                        <ArrowUp className="icon" aria-hidden="true" />
                        <span className="sr-only">{f.label}を</span>上へ
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={i === fields.length - 1}
                        onClick={() =>
                          act(`/api/request-fields/${f.id}/move`, {
                            dir: 'down',
                          })
                        }
                      >
                        <ArrowDown className="icon" aria-hidden="true" />
                        <span className="sr-only">{f.label}を</span>下へ
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setEditing(f.id)}
                      >
                        <PenLine className="icon" aria-hidden="true" />
                        <span className="sr-only">{f.label}を</span>編集
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          act(
                            `/api/request-fields/${f.id}`,
                            { ...f, active: !f.active },
                            'PATCH',
                          )
                        }
                      >
                        {f.active ? (
                          <EyeOff className="icon" aria-hidden="true" />
                        ) : (
                          <Eye className="icon" aria-hidden="true" />
                        )}
                        <span className="sr-only">{f.label}を</span>
                        {f.active ? '使わない' : '使う'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="card pad" aria-labelledby="add-field">
          <h2 id="add-field">
            <Plus className="icon" aria-hidden="true" />
            項目を追加
          </h2>
          <FieldForm
            initial={{
              key: '',
              label: '',
              kind: 'text',
              required: false,
              options: '',
              help: '',
              active: true,
            }}
            isNew
            url="/api/request-fields"
          />
        </section>
      </div>
      <aside className="stack" aria-label="A社に見えるフォーム">
        <section className="card pad">
          <h2>A社に見えるフォーム</h2>
          <p className="meta-line">
            使っている項目だけが、この順番で出ます。ここで入力しても送られません。
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            {fields
              .filter((f) => f.active)
              .map((f) => (
                <IntakeField
                  key={f.id}
                  idPrefix="preview"
                  field={f}
                  value={preview[f.key] ?? ''}
                  onChange={(v) => setPreview((x) => ({ ...x, [f.key]: v }))}
                />
              ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
