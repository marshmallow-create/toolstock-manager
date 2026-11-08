# ToolStock Manager

1工場の切削工具について、工具登録・在庫・入出庫・履歴・ユーザーを管理するWebアプリです。
2026年11月8日時点を、今後の機能追加の基準となる一旦完成した仕様として整理しています。

## 資料

| ファイル | 内容 |
| --- | --- |
| [現行仕様書](docs/specification.md) | 画面、入力項目、権限、在庫、履歴、未実装範囲 |
| [構成](docs/architecture.md) | コードの責務と変更時の確認箇所 |
| [DB設計](docs/database.md) | データ、制約、移行、監査 |
| [整理記録](docs/maintenance.md) | 今回の整理対象と検証結果 |
| [過去の設計判断](docs/decisions.md) | 開発当時の経緯。現行仕様は仕様書を優先 |

`markdown/` は元の開発指示・過去の説明資料です。実装後の変更を含む現在の仕様と操作手順は、このREADMEと現行仕様書を参照してください。

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

シードは架空の工具とA001（作業者）、ADMIN001（管理者）を作成します。既存行の再初期化は行いません。初回パスワードは `.local/dev-credentials.json` に保存されます。資格情報は文書・Git・ログへ転記しないでください。

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

テストはテストDBの一時スキーマを使用し、完了時に削除します。`npm.cmd test` には権限・移行・DB・認証・工具・在庫・HTTPテストと本番ビルドが含まれます。実行時の結果は[整理記録](docs/maintenance.md)を参照してください。

## 維持するファイル

`src/`、`tests/`、`prisma/`、`scripts/`、npmのロックファイル、環境設定を機能追加の基盤として維持します。適用済みのSQL移行は書き換えず、必要な変更を追加移行で行います。

`.env`、`.local/`、DBボリューム、バックアップは実行環境のデータです。不要ファイルの整理対象に含めません。`.cache/` はテスト等で再生成される一時領域です。
