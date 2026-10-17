# ローカル実行と実運用モード

> この文書は以前の版（カートで注文する版）について書いています。今の流れ（A社の依頼から、B社の見積・発注まで）は [README.md](../README.md) を見てください。

## 公開デモと同じ状態で（設定不要）

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`APP_MODE=demo` では、プロセス内のPostgreSQL（PGlite）に架空の会社・3店舗・本社・カタログ・依頼が入った状態で起動します。サーバーを再起動すると初期状態に戻ります。デモのパスワードはログイン画面に表示されます。

## 実運用モード（自分のPostgreSQLと仕入先）

1. PostgreSQL 16 または 17 を用意し、スキーマを入れる。Dockerがあれば：

   ```sh
   npm run db:up
   ```

   `db/schema.sql` と、ローカル用のログインロール `procurement_app` を作る `db/local-roles.sql` が自動で実行されます。別のPostgreSQLを使う場合は、スキーマの所有者で `db/schema.sql` を流し、アプリ用に次のようなログインロールを作ります（パスワードは自分で決める）。

   ```sql
   CREATE ROLE procurement_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT procurement_user TO procurement_app WITH INHERIT FALSE, SET TRUE;
   GRANT procurement_mailer TO procurement_app WITH INHERIT FALSE, SET TRUE;
   GRANT procurement_auth TO procurement_app WITH INHERIT FALSE, SET TRUE;
   ```

   アプリは起動時に、この接続がスーパーユーザー・BYPASSRLS・テーブルの所有者でないことを確かめ、そうでなければ起動しません。

2. `.env.local` を設定する：

   ```sh
   APP_MODE=live
   APP_ORIGIN=https://orders.example.com      # 利用者が開くURL（手元なら http://127.0.0.1:3000）
   DATABASE_URL=postgresql://procurement_app:...@host:5432/procurement
   ADMIN_DATABASE_URL=postgresql://owner:...@host:5432/procurement   # 組織の作成だけに使う
   SMTP_URL=smtps://user:password@smtp.example.com:465                # 任意。なければ通知は送信待ちのまま
   MAIL_FROM=発注ワークフロー <orders@example.com>
   ```

3. 組織・店舗・メンバーを作る。設定ファイルの書き方は `scripts/create-org.ts` の先頭にあります。最初のパスワードは一度だけ表示されます。

   ```sh
   npm run org:create -- org.json
   ```

4. 起動して、管理者で「カタログ管理」→「仕入先を追加」から、仕入先の商品一覧ページのURL（またはCSV）を登録して取り込みます。

   ```sh
   npm run build && npm run start
   ```

5. メールの再送：アプリは変更のたびに送信しますが、失敗した通知の再試行や、停止中に溜まった通知のために、定期実行（例：5分ごと）で次を動かします。

   ```sh
   npm run outbox:send
   ```

## 取り込めないサイト

構造化データ（schema.org の Product・ItemList、または Open Graph の product タグ）を載せていないサイト、ボットのアクセスを拒否するサイト、ログインが必要なサイトは読めません。取り込み結果に理由が表示されます。その場合は仕入先からCSVをもらい、「CSVファイル」の仕入先として登録します。見出しは「商品名」「価格」（または「税込価格」「税抜価格」）が必須で、「品番」「税率」「単位」「カテゴリ」「メーカー」「在庫」「画像URL」「商品URL」も読みます。

仕入先の利用規約で自動取得が禁じられている場合は、サイトからの取り込みではなくCSVを使ってください。
