import { redirect } from 'next/navigation';
import { pageSession } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { listCatalog, listSources } from '../../../../src/server/service';
import { localDemoSupplierUrl } from '../../../../src/server/demo-supplier';
import { DEMO_SUPPLIER } from '../../../../src/demo/supplier-data';
import { SourceCard, NewSource, ItemRow } from './controls';

export const dynamic = 'force-dynamic';

export default async function AdminCatalogPage() {
  const s = await pageSession();
  if (s.role !== 'admin') redirect('/');
  const { deps } = await runtime();
  const sources = await listSources(deps, s);
  const { items } = await listCatalog(deps, s);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>カタログ管理</h1>
          <p className="sub">
            仕入先のサイトに載っている商品データ（schema.org の
            Product・ItemList、または Open
            Graph）を読み取ってカタログにします。CSVでも取り込めます。取り込み直すと価格の変更を反映し、載らなくなった商品は発注できなくなります。
          </p>
        </div>
      </div>
      {deps.demo && (
        <p className="notice" style={{ marginBottom: 16 }}>
          公開デモでは、同梱の架空の仕入先サイト（{DEMO_SUPPLIER.origin}、
          <a
            href={`${DEMO_SUPPLIER.localPath}/index.html`}
            target="_blank"
            rel="noreferrer noopener"
          >
            このアプリ内で表示
          </a>
          ）だけを取り込めます。読み取りは実際のサイトと同じ処理で、外部には接続しません。
        </p>
      )}
      <div className="stack">
        {sources.map((src) => (
          <SourceCard
            key={src.id}
            source={JSON.parse(JSON.stringify(src))}
            viewUrl={localDemoSupplierUrl(src.urls[0]) ?? null}
          />
        ))}
        <NewSource
          demo={deps.demo}
          demoUrl={`${DEMO_SUPPLIER.origin}${DEMO_SUPPLIER.catalogPath}`}
        />
        <section className="card" aria-labelledby="items-heading">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="items-heading">商品（{items.length}件）</h2>
            <p className="sub" style={{ marginTop: -6 }}>
              税率と単位は取り込み直しても上書きしません。「店舗に表示」を外すと店舗のカタログに出なくなります。
            </p>
          </div>
          <div className="scroll-x">
            <table className="list lines">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">掲載価格</th>
                  <th className="num">参考単価（税抜）</th>
                  <th>税率</th>
                  <th>単位</th>
                  <th>状態</th>
                  <th>店舗に表示</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={JSON.parse(JSON.stringify(i))}
                    productUrl={localDemoSupplierUrl(i.product_url)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
