import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="center-wrap">
      <div className="glass strong pad empty" style={{ maxWidth: 480 }}>
        <SearchX className="icon" aria-hidden="true" />
        <h1 style={{ fontSize: 24 }}>ページが見つかりません</h1>
        <p className="sub" style={{ margin: 0 }}>
          URLが正しいか、表示する権限があるかを確認してください。
        </p>
        <a className="btn primary" href="/">
          <ArrowLeft className="icon" aria-hidden="true" />
          依頼一覧へ
        </a>
      </div>
    </main>
  );
}
