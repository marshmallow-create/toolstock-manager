# ToolStock Manager

1工場の切削工具を管理するローカルWebアプリです。工具登録・在庫・入出庫履歴・発注確認・Excel一括登録／変更・ユーザー管理を提供します。

## 現行資料

| 資料 | 内容 |
| --- | --- |
| [仕様](docs/specification.md) | 画面、権限、在庫・金額・発注の計算 |
| [構成](docs/architecture.md) | コードの責務、処理と競合制御 |
| [DB](docs/database.md) | 現行テーブル、制約、整理移行 |
| [Excel](docs/excel-import.md) | 共通テンプレート、確認・確定、出力 |
| [保守](docs/maintenance.md) | 検証、バックアップ、整理記録 |

## 必要環境

Node.js 22.12以上、npm、Docker Desktop / Docker Compose v2を使用します。Windows PowerShellでは `npm.cmd` を使用してください。依存バージョンは `package-lock.json` で固定しています。

## 初回セットアップ

既存の `.env` と業務データは上書きしません。新規環境では次を実行します。

```powershell
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item .env.example .env }
npm.cmd ci --cache .npm-cache
docker compose up -d --wait
npm.cmd run db:generate
npm.cmd run db:migrate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

http://127.0.0.1:3000/ を開きます。`APP_ORIGIN` はアクセス先と一致させます。DBは127.0.0.1にのみ公開します。

シードは架空の工具とA001（作業者）・ADMIN001（管理者）を作成します。初期パスワードは `.local/dev-credentials.json` に保存されます。既存環境ではシードの再投入は不要です。資格情報はGit・文書・ログへ転記しません。

## 通常起動・停止

```powershell
docker compose up -d --wait
npm.cmd run dev
# 本番モードの確認
npm.cmd run build
npm.cmd start
```

同じポートで開発モードと本番モードを同時起動しません。WebはCtrl+C、DBは `docker compose stop` で停止します。通常の停止でDBボリュームを削除しません。

## 検証とDB更新

`.env` の `TEST_DATABASE_URL` に開発DBとは別のテストDBを指定します。初回だけ作成してください。

```powershell
docker compose exec db createdb -U toolstock toolstock_test
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd test
```

テストは専用DBの一時スキーマを使用します。全体テストには移行・権限・認証・在庫・発注・Excel・HTTP・本番ビルドが含まれます。

既存DBの更新は `npm.cmd run db:backup` でバックアップを取得後、`npm.cmd run db:migrate` を実行します。適用済みSQLは編集せず追加移行を使います。詳細と今回の検証結果は[保守](docs/maintenance.md)を参照してください。

## データと一時ファイル

`.env`、`.local/dev-credentials.json`、`backups/`、DBボリュームは実行環境のデータです。Gitには含めません。`.cache/` は検証時の再生成領域、`.next/` はビルド・開発サーバー用です。稼働中のファイルは削除しません。完了済みの検証画像・ログ・作業メモは現行仕様へ集約して整理します。
