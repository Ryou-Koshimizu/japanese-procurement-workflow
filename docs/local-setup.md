# ローカル実行と実運用モード

## 公開デモと同じ状態で動かす（設定なし）

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`APP_MODE=demo` では、プロセスの中のPostgreSQL（PGlite）に次のデータを入れて起動します。

- B社：みどり購買サポート株式会社（担当者の山田 花子、管理者の田中 誠）
- A社：株式会社サンプルカフェ（渋谷店・梅田店・博多店。渋谷店の佐藤 美咲、梅田店の鈴木 健）
- 登録メーカー3社：さくら備品サプライ・あおば什器製作所・ひかり家具工業（すべて架空）
- さくら備品サプライのカタログ23商品（同梱の架空のサイトから、実運用と同じ処理で取り込んだもの）
- 7件の依頼（納期確定・合意済み・見積書の回答待ち・相見積中・質問の回答待ち・新規・お断り）

7件の依頼は、画面と同じ処理を順に通して作っています。パスワードは全員 `demo-password-2026` で、ログイン画面にも表示します。メールは送らず、送る内容を画面の「通知」に表示します。サーバーを再起動するか、管理者で「デモを初期化」を押すと、最初の状態に戻ります。

## 実運用モード（自分のPostgreSQLとメーカー）

### 1. PostgreSQLを用意する

PostgreSQL 16 か 17 を使います（CIは両方でテストしています）。Docker があれば次の1行です。

```sh
npm run db:up
```

PostgreSQL 17 が `127.0.0.1:54326` で起動し、`db/schema.sql` と、ローカル用のログインロール `procurement_app` を作る `db/local-roles.sql` が流れます。

別のPostgreSQLを使うときは、スキーマの所有者で `db/schema.sql` を流し、アプリが接続するログインロールを作ります（パスワードは自分で決めます）。

```sql
CREATE ROLE procurement_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT procurement_user TO procurement_app WITH INHERIT FALSE, SET TRUE;
GRANT procurement_mailer TO procurement_app WITH INHERIT FALSE, SET TRUE;
GRANT procurement_auth TO procurement_app WITH INHERIT FALSE, SET TRUE;
```

アプリは起動のときに、この接続がスーパーユーザー・BYPASSRLS・表の所有者でないことと、3つのロールのメンバーであることを確かめます。条件に合わない接続では起動しません。

### 2. `.env.local` を書く

```sh
APP_MODE=live
APP_ORIGIN=https://orders.example.com      # 利用者が開くURL（手元なら http://127.0.0.1:3000）
DATABASE_URL=postgresql://procurement_app:...@host:5432/procurement
ADMIN_DATABASE_URL=postgresql://owner:...@host:5432/procurement   # 会社の作成（npm run org:create）だけに使う
SMTP_URL=smtps://user:password@smtp.example.com:465                # 任意。空なら通知は送信待ちのまま残る
MAIL_FROM=備品発注 <orders@example.com>                            # SMTP_URL を書いたときは必須
```

`APP_ORIGIN` は、別サイトからの送信の判定、cookie の Secure、メールに入れるリンクに使います。

### 3. 会社・拠点・メンバーを作る

`org.json` を用意します（書き方は `scripts/create-org.ts` の先頭と同じです）。

```json
{
  "name": "〇〇購買サポート株式会社",
  "client_name": "株式会社〇〇",
  "address": "B社の受入先の住所（B社経由で届けるとき。省略できます）",
  "stores": [{ "code": "S01", "name": "渋谷店", "address": "東京都渋谷区…" }],
  "people": [
    { "email": "admin@example.com", "name": "田中 誠", "role": "admin" },
    { "email": "agent@example.com", "name": "山田 花子", "role": "agent" },
    {
      "email": "shibuya@example.com",
      "name": "佐藤 美咲",
      "role": "client",
      "store": "S01"
    }
  ]
}
```

- `name` がB社（このアプリを使う購買代行）、`client_name` がA社（依頼する会社）です。
- `stores` はA社の拠点です。`code` は英数字とハイフンで20文字まで。
- `people` の `role` は `admin`（B社 管理者）・`agent`（B社 担当者）・`client`（A社 担当者）です。管理者は1人以上いります。`client` には `store` に拠点の `code` を書き、B社の人には書きません。

```sh
npm run org:create -- org.json
```

1つのトランザクションで、会社・拠点・メンバーと、標準の依頼フォーム（9項目）を作ります。各メンバーの最初のパスワードは、このとき一度だけ表示します。安全な方法で本人に渡してください。

### 4. 起動して、メーカーを登録する

```sh
npm run build && npm run start
```

1. 管理者は「依頼フォーム」で、A社に聞く項目を足す・直す・並べ替える・使わないにできます。
2. B社の担当者か管理者が「メーカー」でメーカーを登録します。見積依頼と発注書は、ここに書いたメールアドレスに送ります。
3. カタログを使うときは、管理者が「カタログ管理」（`/admin/catalog`）の「カタログを追加」で、メーカーの商品一覧ページのURLかCSVを登録して取り込みます。取り込んだカタログは、「メーカー」の「カタログ」欄でメーカーに結びつけます。B社は商品概要を書くとき、カタログから商品を選べます。

### 5. メールを送り直す仕組みを入れる

アプリは変更のたびにメールを送ります。送れなかった通知の再試行と、サーバーが止まっていた間にたまった通知のために、定期実行（例：5分ごと）で次を動かします。

```sh
npm run outbox:send
```

`APP_MODE=live`・`SMTP_URL`・`MAIL_FROM` が揃っているときに動きます。

## サイトから取り込めないとき

取り込めるのは、構造化データ（schema.org の `Product`・`ItemList`、または Open Graph の product タグ）を載せたページです。ボットのアクセスを断るサイトやログインが要るサイトでは、取り込みの結果に理由を表示します。そのときはメーカーからCSVをもらい、「CSVファイル」のカタログとして登録します。

CSVは UTF-8 か Shift_JIS です。見出しは「商品名」と「価格」（または「税込価格」「税抜価格」）が必須で、「品番」「税率」「単位」「カテゴリ」「メーカー」「在庫」「画像URL」「商品URL」も読みます。

メーカーのサイトの利用規約が自動での取得を禁じているときは、サイトからの取り込みではなくCSVを使います。
