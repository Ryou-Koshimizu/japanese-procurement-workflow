export default function NotFound() {
  return (
    <main className="login-wrap">
      <div className="login card pad">
        <h1>ページが見つかりません</h1>
        <p className="sub">
          URLが正しいか、表示する権限があるかを確認してください。
        </p>
        <p>
          <a className="btn" href="/">
            依頼一覧へ
          </a>
        </p>
      </div>
    </main>
  );
}
