import { ArrowLeft, SearchX } from 'lucide-react';
import Brand from './brand';
import ThemeSwitch from './theme-switch';

export default function NotFound() {
  return (
    <>
      <header className="top">
        <Brand />
        <ThemeSwitch className="compact" />
      </header>
      <main className="center-wrap" id="main">
        <div className="card pad empty lost">
          <span className="lost-no" aria-hidden="true">
            404
          </span>
          <SearchX className="icon" aria-hidden="true" />
          <h1>ページが見つかりません</h1>
          <p className="sub">
            URLが正しいか、表示する権限があるかを確認してください。
          </p>
          <a className="btn primary" href="/">
            <ArrowLeft className="icon" aria-hidden="true" />
            ホームへ
          </a>
        </div>
      </main>
    </>
  );
}
