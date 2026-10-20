# Security Policy

## 脆弱性の報告

脆弱性を見つけた場合は、公開のIssueではなく、GitHubの [Private vulnerability reporting](https://github.com/Ryou-Koshimizu/japanese-procurement-workflow/security/advisories/new) から非公開で報告してください。

報告に含めてほしいもの：

- 影響を受けるファイル・エンドポイント・コミット
- 再現手順（架空のデータで再現できる形）
- 想定される影響

受け取ったら7日以内を目安に連絡します。修正までの間、詳細の公開は控えてください。

## 受け付ける範囲

- `main` ブランチの最新のコミット
- 公開デモ（`APP_MODE=demo`）と実運用モード（`APP_MODE=live`）のアプリ、DBのスキーマ、CIの設定

依存パッケージそのものの脆弱性は、それぞれのプロジェクトへ報告してください。利用者が自分で用意した環境の設定、ソーシャルエンジニアリング、DoS は、このリポジトリの報告の範囲に含めていません。

## このリポジトリが行っている対策

- 権限・拠点の分離・原価の非表示・状態の変更・金額・監査ログ・通知を、PostgreSQLの行レベルセキュリティ（RLS）とトリガーで強制しています（[ADR 001](docs/adr/001-database-enforced-workflow.md)）。原価・利益・メーカーは、A社が読めない表にだけ置いています。
- メーカーのサイトを取り込むときのSSRF対策など、脅威ごとの対策と確認方法は [脅威と対策](docs/security.md)、公開前の点検とその後の直しは [公開前のセキュリティ確認](docs/security-publication.md) にあります。
- GitHub側：Secret scanning と Push protection、Dependabot、CodeQL、依存関係の審査、GitHub Actions のコミット固定と最小限の権限。

## 秘密情報について

リポジトリには、APIキー、実在の会社や人物のデータ、実在のメーカーや通販サイトから取り込んだデータを含めません。`.env.example`・`docker-compose.yml`・`db/local-roles.sql` のDBのパスワードは、ローカル専用の公開サンプル値です。本番や共有の環境では、自分で決めた値を使ってください。
