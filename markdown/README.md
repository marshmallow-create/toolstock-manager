# ToolStock Manager

Phase 2（認証・権限）まで実装済み。既存の開発指示書を要件の基準とします。データはすべて架空、外部送信・本番デプロイはありません。

## 必要環境

Node.js 22.12以上（LTS推奨）、npm、Docker Desktop（Linux containers / Compose v2）。PowerShellでは実行ポリシー変更を避けて `npm.cmd` を使用します。

## 初回起動（PowerShell）

```powershell
Copy-Item .env.example .env
npm.cmd install --cache .npm-cache
npm.cmd run db:generate
docker compose up -d --wait
npm.cmd run db:migrate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

http://127.0.0.1:3000/login を開きます。ログイン後の`/api/health/db` は接続と tools テーブルを確認し、成功時200、接続・未適用DDLエラー時503を返します。詳細な接続情報は返しません。DBとWebはlocalhost限定です。

依存は package.json で完全固定しています。package-lock.json は生成済みです。以後の再現インストールには `npm.cmd ci` を使用してください。Prismaスキーマ検証・型検査・本番ビルドは成功しています。

シードは明示許可が必要です。再実行しても既存マスタ・在庫・履歴を更新しません。A001 / S001 / P001 / ADMIN001 は架空ユーザーです。auth:setup-dev で個別のランダムパスワードを設定し、.local/dev-credentials.json に保存します。このファイルはGit対象外です。既存資格情報を上書きせず、コンソールや文書へパスワードを出力しません。実環境では使用しないでください。

## 検証

```powershell
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd run build
# 専用DBの作成は初回だけ
 docker compose exec db createdb -U toolstock toolstock_test
npm.cmd run test:db
# 再実行しても件数・残高が変わらないことを確認
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run db:seed
Remove-Item Env:ALLOW_LOCAL_SEED
```

DBテストは TEST_DATABASE_URL（DB名にtestを含むこと）を使い、一時スキーマへのDDL適用と負在庫・過剰引当・重複棚在庫・FK・二重リクエスト・履歴改変拒否を検証しロールバックします。既存の phase1_test スキーマがある場合は停止します。同時出庫・認可・発注ワークフローの検証はPhase 2〜5で実装します。

ビルド後の起動は `npm.cmd start`。開発サーバーは Ctrl+C で停止、DBは `docker compose stop`。`docker compose down` でもボリュームは保持します。`down -v` はデータを消すため通常使用しません。

## ローカルバックアップ・復元

```powershell
New-Item -ItemType Directory -Force backups
# Windows PowerShellのバイナリリダイレクトを避け、コンテナ内で生成してコピー
 docker compose exec db pg_dump -U toolstock -d toolstock_dev -Fc -f /tmp/toolstock.dump
 docker compose cp db:/tmp/toolstock.dump backups/toolstock.dump
# 復元先は新しい検証専用DB
 docker compose exec db createdb -U toolstock toolstock_restore_test
 docker compose cp backups/toolstock.dump db:/tmp/restore.dump
 docker compose exec db pg_restore -U toolstock -d toolstock_restore_test --no-owner --exit-on-error /tmp/restore.dump
 docker compose exec db psql -U toolstock -d toolstock_restore_test -c 'SELECT count(*) FROM tools;'
```

復元手順は今回未実行。本番投入前に件数・残高・履歴を照合してください。

## Phase 1の検証記録（2026-11-03）

Phase 1の主要な受入確認が完了しました。

- Docker ComposeのDB起動: 通常のPowerShellで利用者が実施、PostgreSQLへの接続成功を確認。
- `db:validate`、Client生成、`typecheck`、`build`: 成功。
- `db:migrate`: 初期マイグレーション適用成功。再実行は適用待ちなし。
- `db:seed`: 成功。架空ユーザー4件、工具4件、設備3件、棚3件、仕入先1件、在庫4件・合計80、初期入庫履歴4件。
- シード再実行: 全13テーブルの全行を比較し、既存データ・残高・履歴が不変であることを確認。
- `test:db`: 1テスト成功、失敗0。負在庫、過剰引当、棚在庫重複、参照整合性、履歴更新/削除、二重リクエストを検証。
- Webトップ: HTTP 200、タイトル確認。`/api/health/db`: HTTP 200、status=ok、tools=4。DB停止時503も確認済み。
- バックアップ復元、同時出庫、認証認可、発注処理は今回の検証対象外。後続Phaseで確認。

### 制限環境への対応

CodexからDockerエンジンへのアクセスは拒否されるため、コンテナの起動・停止は通常のPowerShellで実施してください。ユーザー別インストールのDocker CLIを現在のPowerShellだけで利用する場合:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
docker info
```

この環境ではtsxがOSユーザー情報取得（uv_os_get_passwd）で失敗したため、seedとDBテストは `scripts/run-typescript.mjs` でTypeScriptをJavaScriptへ変換して実行します。esbuildを直接依存に固定し、tsxは削除しました。生成物は `.cache/typescript/`（Git対象外）です。操作コマンドは従来どおり `npm.cmd run db:seed` / `npm.cmd run test:db` です。

## Phase 2の使い方

既存環境では次を実行します。今回の開発DBには追加マイグレーションと初期資格情報の設定を適用済みです。既にサーバーを起動している場合はCtrl+Cで停止してから再起動してください。

```powershell
npm.cmd run db:migrate
npm.cmd run db:generate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

ログインURL: http://127.0.0.1:3000/login 。パスワードは .local/dev-credentials.json を手元のエディターで確認してください。

| 社員ID | ロール |
| --- | --- |
| A001 | 作業者 |
| S001 | 在庫管理者 |
| P001 | 購買担当 |
| ADMIN001 | 管理者 |

- /dashboard は全ロールがログイン後に利用可能。許可される操作を表示する。
- /admin/users は管理者専用。登録・氏名/ロール変更・無効化/再有効化・パスワード再設定を行う。ユーザー削除は行わない。
- ログアウト、無操作30分、最長8時間でセッション失効。権限/状態/パスワード変更でも既存セッションを失効させる。
- DBにはsalt付きscryptハッシュとセッショントークンのSHA-256ハッシュのみ保存。ログイン・ログアウト・ユーザー管理の成功操作を監査記録する。ログイン失敗はDBの試行制限で追跡し、5回失敗すると15分間制限する。
- POSTはAPP_ORIGINとのOrigin照合が必要。.env.example の値は http://127.0.0.1:3000 。localhostや別ポートでアクセスする場合はAPP_ORIGINも変更してサーバーを再起動する。HTTPSではCookieにSecureを付ける。
- ログインAPIはユーザー情報とCookieを返す。トークンをJSONで返さない。ユーザー一覧へpassword_hashを含めない。
- GET /api/auth/session、GET /api/health/db は未ログイン時401。GET /api/admin/users とPOST /api/admin/users[/id] は未ログイン401、権限不足403。フォーム入力エラーはメッセージ付き303遷移、JSONは400/409等を返す。
- DB接続APIは認証済みの場合のみ利用する。Phase 1時点の匿名200から変更した。

### Phase 2検証

```powershell
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd test
```

npm test は既存DB制約テスト1件、認証サービス10件、本番ビルド、HTTP結合テスト4件を順に実行する（合計15件）。TEST_DATABASE_URLはDB名にtestを含む専用DBとし、開発DBと分離する。認証テストは毎回一時スキーマへ全マイグレーションを適用し、終了時に一時スキーマを削除する。HTTPテストは空きローカルポートで実際のNext.jsサーバーを起動し、終了時に停止する。

2026-11-03: 15件成功、失敗0。型検査・Prisma validate/generate・ビルド成功。権限表、セッション失効、並行試行制限、管理者の相互降格、Cookie、401/403、Origin、JSON/APIとHTMLフォーム遷移を確認。開発DBの既存在庫・履歴・マスタ・発注は11テーブル全行の前後比較で不変。資格情報設定の再実行でも資格情報ファイルが不変。

ブラウザ上の見た目・タブレットでの操作確認は未実施。画面のHTMLとフォーム処理はHTTP経由で検証済み。社内ID連携、期限切れレコードの定期清掃、本番用DB権限分離・運用設定は後続で確定する。

### ファイル配置

npm/Next.jsの正本となる package.json・package-lock.json・tsconfig.json はプロジェクトルートに置く。作業中にjson/へ移動された元ファイルは保持したが、以後の編集対象はルート側とする。Markdown文書はMarkdown/とdocs/を使用する。
