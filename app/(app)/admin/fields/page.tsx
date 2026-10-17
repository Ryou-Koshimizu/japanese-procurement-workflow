import { redirect } from 'next/navigation';
import { TextCursorInput } from 'lucide-react';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listRequestFields } from '../../../../src/server/service';
import FieldsEditor from './fields-editor';

export const dynamic = 'force-dynamic';

export default async function FieldsPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const fields = await listRequestFields(deps, s, true);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <TextCursorInput className="icon sm" aria-hidden="true" />
            B社 管理者
          </span>
          <h1>依頼フォーム</h1>
          <p className="sub">
            A社が依頼するときに答える項目です。電話で毎回聞いていることを項目にすると、ヒアリングが短くなります。項目は消さずに「使わない」にします（送られた依頼の回答はそのまま残ります）。
          </p>
        </div>
      </div>
      <FieldsEditor fields={fields} />
    </>
  );
}
