# Security Policy

## 脆弱性の報告

脆弱性を見つけた場合は、公開のIssueではなく、GitHubの [Private vulnerability reporting](https://github.com/Ryou-Koshimizu/japanese-procurement-workflow/security/advisories/new) から非公開で報告してください。

報告に含めてほしいもの：

- 影響を受けるファイル・エンドポイント・コミット
- 再現手順（架空データで再現できる形）
- 想定される影響

受領の連絡は7日以内を目安に行います。修正までの間、詳細の公開は控えてください。

## 対象

- `main` ブランチの最新コミット
- 公開デモ（`APP_MODE=demo`）と実運用モード（`APP_MODE=live`）のアプリ、DBスキーマ、CI設定

対象外：依存パッケージそのものの脆弱性（各プロジェクトへ報告してください）、利用者が自分で用意した環境の設定不備、ソーシャルエンジニアリング、DoS。

## このリポジトリが行っている対策

- 権限・店舗の分離・状態遷移・金額・監査ログ・通知はPostgreSQLの行レベルセキュリティとトリガーで強制（[ADR 001](docs/adr/001-database-enforced-workflow.md)）
- 仕入先サイトの取り込みでのSSRF対策など、脅威ごとの対策と確認方法は [脅威と対策](docs/security.md)、公開前の点検結果は [公開前のセキュリティ確認](docs/security-publication.md)
- GitHub側：Secret scanningとPush protection、Dependabot、CodeQL、依存関係の審査、GitHub Actionsのコミット固定と最小権限

## 秘密情報について

リポジトリにAPIキー・実在の会社や人物のデータ・実在の仕入先サイトから取り込んだデータは含めません。`.env.example` と `db/local-roles.sql` のDBパスワードはローカル専用の公開サンプル値です。本番・共有環境では使わないでください。
