# ToolStock Manager

1工場の切削工具について、工具登録・在庫・入出庫・履歴・ユーザーを管理するWebアプリです。
現行の画面・権限・運用手順は以下の文書に集約しています。

## 資料

| ファイル | 内容 |
| --- | --- |
| [現行仕様書](docs/specification.md) | 画面、入力項目、権限、在庫、履歴、未実装範囲 |
| [構成](docs/architecture.md) | コードの責務と変更時の確認箇所 |
| [DB設計](docs/database.md) | データ、制約、移行、監査 |
| [Excel一括登録](docs/excel-import.md) | テンプレート、入力制限、確認・確定 |
| [保守](docs/maintenance.md) | 開発ルール、整理方針、検証結果 |

## 必要環境

- Node.js 22.12以上、npm
- Docker Desktop / Docker Compose v2（ローカルPostgreSQL用）
- Windows PowerShellでは `npm.cmd` を使用

## 初回セットアップ

既存の `.env` がある場合は上書きしません。

```powershell
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item .env.example .env }
npm.cmd ci --cache .npm-cache
npm.cmd run db:generate
docker compose up -d --wait
npm.cmd run db:migrate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

http://127.0.0.1:3000/ を開きます。DBもWebもローカル接続です。`APP_ORIGIN` とアクセスURLのオリジンを一致させてください。

新規DBのシードは架空の工具とA001（作業者）、ADMIN001（管理者）を作成します。既存行の再初期化や削除済みユーザーの復活は行いません。既存環境ではシード再投入は不要です。初回パスワードは `.local/dev-credentials.json` に保存されます。資格情報は文書・Git・ログへ転記しないでください。

## 通常の起動・停止

```powershell
docker compose up -d --wait
npm.cmd run dev
# 本番モードで確認する場合
npm.cmd run build
npm.cmd start
```

開発モードと本番モードは同じポートで同時起動しません。WebはCtrl+C、DBは `docker compose stop` で停止します。DBボリュームを削除する操作は、通常の停止手順に含めません。

## 検証

`.env` の `TEST_DATABASE_URL` に、開発DBとは別のテストDBを設定します。初回だけ以下で作成します。

```powershell
docker compose exec db createdb -U toolstock toolstock_test
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd test
```

テストはテストDBの一時スキーマを使用し、完了時に削除します。`npm.cmd test` には権限・移行・DB・認証・工具・在庫・Excel・HTTPテストと本番ビルドが含まれます。実行時の結果は[保守](docs/maintenance.md)を参照してください。

## 維持するファイル

工具・在庫・履歴・ユーザーは通常の業務画面から操作します。廃止した「データ管理」の表形式編集画面・専用APIは提供しません。

`src/`、`tests/`、`prisma/`、`scripts/`、npmのロックファイル、環境設定を機能追加の基盤として維持します。適用済みのSQL移行は書き換えず、必要な変更を追加移行で行います。

`.env`、`.local/`、DBボリューム、バックアップは実行環境のデータです。不要ファイルの整理対象に含めません。`.cache/` はテスト等で再生成される一時領域です。
