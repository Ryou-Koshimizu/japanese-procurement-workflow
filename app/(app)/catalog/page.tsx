import { redirect } from 'next/navigation';
import { ExternalLink, PackageSearch, Search, Store } from 'lucide-react';
import { pageSession } from '../../../src/server/http';
import { runtime } from '../../../src/server/runtime';
import { listCatalog, listSources } from '../../../src/server/service';
import { isAgent } from '../../../src/core/workflow';
import { localDemoSupplierUrl } from '../../../src/server/demo-supplier';
import { imageUrl, yen } from '../../../src/ui/format';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; source?: string }>;
}) {
  const s = await pageSession();
  if (!isAgent(s.role)) redirect('/');
  const { deps } = await runtime();
  const params = await searchParams;
  const q = String(params.q ?? '').slice(0, 100);
  const category = params.category
    ? String(params.category).slice(0, 100)
    : undefined;
  const sources = await listSources(deps, s);
  const sourceId = sources.some((x) => x.id === params.source)
    ? params.source
    : sources[0]?.id;
  const { items, categories } = sourceId
    ? await listCatalog(deps, s, { sourceId, q, category })
    : { items: [], categories: [] };
  const source = sources.find((x) => x.id === sourceId);
  const link = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const merged = { source: sourceId, q: q || undefined, category, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/catalog?${u}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <Store className="icon sm" aria-hidden="true" />
            {source?.name ?? 'メーカー'}
          </span>
          <h1>カタログ</h1>
          <p className="sub">
            {source
              ? `${source.name}のサイトから取り込んだ商品です。商品概要を書くときに「カタログから選ぶ」で使えます。価格は取り込み時点の参考価格（税抜換算）で、原価はメーカーの見積で決まります。`
              : 'カタログが登録されていません。'}
          </p>
        </div>
        {source?.urls[0] && (
          <a
            className="btn"
            href={localDemoSupplierUrl(source.urls[0]) ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink className="icon" aria-hidden="true" />
            メーカーのサイトを開く
          </a>
        )}
      </div>

      <div className="toolbar">
        {sources.length > 1 && (
          <div className="chips" aria-label="メーカー">
            {sources.map((x) => (
              <a
                key={x.id}
                className="chip"
                href={`/catalog?source=${x.id}`}
                aria-current={x.id === sourceId ? 'page' : undefined}
              >
                {x.name}
              </a>
            ))}
          </div>
        )}
        <form action="/catalog" role="search" className="search">
          <Search className="icon" aria-hidden="true" />
          <input type="hidden" name="source" value={sourceId ?? ''} />
          {category && <input type="hidden" name="category" value={category} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="商品名・メーカー・品番で探す"
            aria-label="商品を検索"
            data-first
          />
          <button className="btn" type="submit">
            検索
          </button>
        </form>
        <div className="chips" aria-label="カテゴリ">
          <a
            className="chip"
            href={link({ category: undefined })}
            aria-current={!category ? 'page' : undefined}
          >
            すべて
          </a>
          {categories.map((c) => (
            <a
              key={c}
              className="chip"
              href={link({ category: c })}
              aria-current={c === category ? 'page' : undefined}
            >
              {c}
            </a>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card empty">
          <PackageSearch className="icon" aria-hidden="true" />
          <b>該当する商品はありません</b>
          {(q || category) && (
            <a
              className="btn"
              href={link({ q: undefined, category: undefined })}
            >
              条件を外す
            </a>
          )}
        </div>
      ) : (
        <section className="products" aria-label="商品">
          {items.map((i) => {
            const pic = imageUrl(i.image_id);
            const orderable = i.active && i.available;
            return (
              <article key={i.id} className="card product">
                <div className="pic-wrap">
                  {pic ? (
                    <img
                      className="pic"
                      src={pic}
                      alt=""
                      width={480}
                      height={480}
                      loading="lazy"
                    />
                  ) : null}
                  {(i.tax_rate === 8 || !i.available || !i.active) && (
                    <span className="tags">
                      {i.tax_rate === 8 && (
                        <span className="tag reduced">軽減税率8%</span>
                      )}
                      {!i.available && (
                        <span className="tag off">取り扱いなし・在庫切れ</span>
                      )}
                      {!i.active && <span className="tag off">使わない</span>}
                    </span>
                  )}
                </div>
                <div className="body">
                  {i.brand && <span className="maker">{i.brand}</span>}
                  <span className="name">{i.name}</span>
                  <span className="price num">
                    <b>{yen(i.unit_price)}</b>
                    <small>税抜 / {i.unit}</small>
                  </span>
                  <span className="meta-line">
                    掲載価格 {yen(i.listed_price)}
                    {i.price_includes_tax ? '（税込）' : '（税抜）'}
                    {i.sku ? `・${i.sku}` : ''}
                  </span>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
