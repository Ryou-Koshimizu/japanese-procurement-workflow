import { redirect } from 'next/navigation';
import { SquarePen } from 'lucide-react';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listRequestFields } from '../../../../src/server/service';
import { todayInJapan } from '../../../../src/server/config';
import RequestForm from './request-form';

export const dynamic = 'force-dynamic';

export default async function NewRequestPage() {
  const s = await pageSession();
  if (s.role !== 'client') redirect('/');
  const { deps } = await runtime();
  const fields = await listRequestFields(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <SquarePen className="icon sm" aria-hidden="true" />
            A社 {s.storeName}
          </span>
          <h1>依頼する</h1>
          <p className="sub">
            ほしい什器・備品について、B社が決めた項目に答えてください。B社が内容を確認し、わからない点は質問が届きます。
          </p>
        </div>
      </div>
      <section className="card pad" aria-label="依頼の内容">
        <RequestForm fields={fields} today={todayInJapan()} />
      </section>
    </>
  );
}
