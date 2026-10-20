'use client';
import { useState } from 'react';
import { Send } from 'lucide-react';
import {
  validateAnswers,
  type RequestField,
} from '../../../../src/core/intake';
import { IntakeField } from '../../../../src/ui/intake-field';
import { ErrorLine, useAction } from '../../../../src/ui/form';
import { PressButton } from '../../../../src/ui/press-button';

export default function RequestForm({
  fields,
  today,
}: {
  fields: RequestField[];
  today: string;
}) {
  const [title, setTitle] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [local, setLocal] = useState<Record<string, string>>({});
  const action = useAction();
  const errors = { ...action.fields, ...local };

  const submit = () => {
    const answers = fields
      .filter((f) => (values[f.key] ?? '').trim() !== '')
      .map((f) => ({ key: f.key, value: values[f.key] }));
    const v = validateAnswers(fields, answers);
    const e: Record<string, string> = v.ok ? {} : { ...v.errors };
    if (!title.trim()) e._title = '件名を入力してください。';
    if (neededBy && neededBy < today)
      e._needed_by = '「いつまでに」は今日以降にしてください。';
    setLocal(e);
    if (Object.keys(e).length) {
      action.setError('入力内容を確認してください。');
      return;
    }
    action.run(
      '/api/requests',
      { title, answers, needed_by: neededBy || null, note: note || null },
      {
        then: (json) =>
          window.location.assign(`/orders/${json.result as string}`),
      },
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="form-grid">
        <div className="field wide">
          <label htmlFor="title">
            件名<span className="req-mark">（必須）</span>
          </label>
          <input
            id="title"
            type="text"
            maxLength={100}
            value={title}
            placeholder="例：受付カウンターの入れ替え"
            data-first
            aria-invalid={errors._title ? true : undefined}
            aria-describedby={errors._title ? 'title-err' : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors._title && (
            <span className="field-error" id="title-err">
              {errors._title}
            </span>
          )}
        </div>
        {fields.map((f) => (
          <IntakeField
            key={f.key}
            field={f}
            value={values[f.key] ?? ''}
            error={errors[f.key]}
            onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))}
          />
        ))}
        <div className="field">
          <label htmlFor="needed-by">
            いつまでに<span className="help">（任意）</span>
          </label>
          <input
            id="needed-by"
            type="date"
            min={today}
            value={neededBy}
            aria-invalid={errors._needed_by ? true : undefined}
            aria-describedby={errors._needed_by ? 'needed-by-err' : undefined}
            onChange={(e) => setNeededBy(e.target.value)}
          />
          {errors._needed_by && (
            <span className="field-error" id="needed-by-err">
              {errors._needed_by}
            </span>
          )}
        </div>
        <div className="field wide">
          <label htmlFor="note">
            B社へのメモ<span className="help">（任意）</span>
          </label>
          <textarea
            id="note"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：営業中の工事は避けたいです。"
          />
          {errors._note && <span className="field-error">{errors._note}</span>}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <ErrorLine message={action.error} />
      </div>
      <div className="actions section">
        <PressButton
          className="btn primary big"
          type="submit"
          state={action.state}
        >
          <Send className="icon" aria-hidden="true" />
          B社に依頼を送る
        </PressButton>
        <span className="meta-line">
          送ると依頼番号が付き、B社に通知が届きます。
        </span>
      </div>
    </form>
  );
}
