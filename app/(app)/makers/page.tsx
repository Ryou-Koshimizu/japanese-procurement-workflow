import { redirect } from 'next/navigation';
import { Factory } from 'lucide-react';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { listMakers, listSources } from '../../../src/server/service';
import { isAgent } from '../../../src/core/workflow';
import MakersEditor from './makers-editor';

export const dynamic = 'force-dynamic';

export default async function MakersPage() {
  const s = await pageSession();
  if (!isAgent(s.role)) redirect('/');
  const { deps } = await runtime();
  const makers = await listMakers(deps, s);
  const sources = await listSources(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Factory className="icon sm" aria-hidden="true" />
            {s.orgName}
          </span>
          <h1>メーカー</h1>
          <p className="sub">
            見積を頼むメーカーです。依頼ごとに1社にも複数社（相見積）にも頼めます。A社にはメーカーの名前も原価も見えません。
          </p>
        </div>
      </div>
      <MakersEditor
        makers={JSON.parse(JSON.stringify(makers))}
        sources={sources.map((x) => ({ id: x.id, name: x.name }))}
      />
    </>
  );
}
