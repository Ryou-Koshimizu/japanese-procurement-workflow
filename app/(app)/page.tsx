import {
  CalendarCheck,
  ClipboardList,
  Hourglass,
  JapaneseYen,
  ListChecks,
  SquarePen,
  Sparkles,
} from 'lucide-react';
import { pageSession } from '../../src/server/http';
import { runtime } from '../../src/server/runtime';
import { listOrders, myTurn, orderStats } from '../../src/server/service';
import { isAgent, statusLabels, type Status } from '../../src/core/workflow';
import { yen } from '../../src/ui/format';
import OrderRows from './order-rows';

export const dynamic = 'force-dynamic';

/** What to do for the requests in each status, said from the side whose turn it is. */
const nextAction: Partial<Record<Status, string>> = {
  requested: '依頼を確認して、質問するか商品概要を決める',
  sourcing: 'メーカーの見積を集めて、見積書をA社に送る',
  agreed: 'メーカーに発注する',
  ordered: 'メーカーに納期を確認して、A社に知らせる',
  hearing: 'B社からの質問に答える',
  quoted: '見積書を確認して、合意するか修正を頼む',
};

export default async function HomePage() {
  const s = await pageSession();
  const { deps } = await runtime();
  const agent = isAgent(s.role);
  const stats = await orderStats(deps, s);
  const todo = await listOrders(deps, s, 'todo');
  const all = agent ? [] : await listOrders(deps, s, 'all');
  const turns = myTurn(s).filter((st) => stats.byStatus[st] > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ClipboardList className="icon sm" aria-hidden="true" />
            {agent ? s.orgName : `A社 ${s.storeName}`}
          </span>
          <h1>ホーム</h1>
          <p className="sub">
            {agent
              ? 'A社からの依頼です。あなたの番の依頼から進めてください。'
              : `${s.storeName}からB社への依頼です。ほしい什器・備品は「依頼する」から送れます。`}
          </p>
        </div>
        {!agent && (
          <a className="btn primary big" href="/requests/new">
            <SquarePen className="icon" aria-hidden="true" />
            依頼する
          </a>
        )}
      </div>

      <div className="metrics">
        <div className="glass metric turn">
          <span className="m-icon" aria-hidden="true">
            <Sparkles className="icon" />
          </span>
          <small>あなたの番</small>
          <b className="num">{stats.todo}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <Hourglass className="icon" />
          </span>
          <small>{agent ? 'A社の返事待ち' : 'B社の対応待ち'}</small>
          <b className="num">{stats.waiting}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <CalendarCheck className="icon" />
          </span>
          <small>今月の納期確定</small>
          <b className="num">{stats.scheduledThisMonth}件</b>
        </div>
        <div className="glass metric">
          <span className="m-icon" aria-hidden="true">
            <JapaneseYen className="icon" />
          </span>
          <small>今月の納期確定の合計（税込）</small>
          <b className="num">{yen(stats.scheduledThisMonthTotal)}</b>
        </div>
      </div>

      <div className="stack">
        {turns.length > 0 && (
          <section className="card pad" aria-labelledby="turn-heading">
            <h2 id="turn-heading">
              <Sparkles className="icon" aria-hidden="true" />
              あなたの番
            </h2>
            <ul className="todo-list">
              {turns.map((st) => (
                <li key={st}>
                  <a href={agent ? `/orders?tab=todo` : '#todo'}>
                    <span>
                      {statusLabels[st]}：{nextAction[st]}
                    </span>
                    <span className="num">{stats.byStatus[st]}件</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="card" id="todo" aria-labelledby="todo-heading">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="todo-heading">
              <ListChecks className="icon" aria-hidden="true" />
              あなたの番の依頼（{todo.length}）
            </h2>
          </div>
          <OrderRows
            rows={todo}
            role={s.role}
            empty="今あなたの番の依頼はありません"
          />
        </section>
        {!agent && (
          <section className="card" aria-labelledby="all-heading">
            <div className="pad" style={{ paddingBottom: 0 }}>
              <h2 id="all-heading">
                <ClipboardList className="icon" aria-hidden="true" />
                {s.storeName}の依頼（{all.length}）
              </h2>
            </div>
            <OrderRows rows={all} role={s.role} empty="まだ依頼はありません" />
          </section>
        )}
      </div>
    </>
  );
}
