# Renderへのデプロイ

構成はシンガポールのWebサービスとPostgreSQL 17。既存ローカルDBは移行せず、空DBに管理者だけを作成する。
`render.yaml` の最初の計画を確認・承認してからリソースを作成する。既存のcat-mouse-gameは変更しない。

## 起動と認証

- ビルド: `npm ci --include=dev && npm run build`
- リリース: `npm run db:migrate && npm run auth:setup-production`
- RenderのPORT・0.0.0.0で待ち受ける。ローカルのnpm startは従来どおり127.0.0.1。
- 公開URLはRenderのRENDER_EXTERNAL_URLから取得する。独自ドメインを使う場合はAPP_ORIGINに実際のHTTPSオリジンを設定する。
- 初期管理者の社員IDはADMIN001。初期パスワードはRenderが生成し、サービスのEnvironmentに保存する。Git・ログ・チャットに転記しない。
- 初回ログイン後にパスワードを変更する。以降のデプロイでは既存管理者とパスワードを変更しない。
- 準備確認はGET /api/health/ready。DB接続を確認し、件数や接続情報は返さない。

## アクセスとバックアップ

WebのURLにはインターネットから到達できるが、業務画面とデータAPIにはログインが必要。
会社のアカウント認証・会社IP制限・VPNはこの構成には含まない。DBは外部接続を禁止し、同一リージョン・ワークスペースの内部ネットワークから接続する。

有料PostgreSQLにはRenderの継続バックアップがある。Hobbyワークスペースは3日、Pro以上は7日のPITRが対象（作成時の公式仕様）。
長期保存はDashboardの論理バックアップを別媒体にダウンロードする。復元は新規DBで内容を確認してから接続先を切り替える。
ローカル専用のnpm run db:backupはRenderのDBには使わない。稼働開始後に復元訓練と保管期間を決める。

## 更新

自動デプロイは無効。mainへの反映後にRenderで明示的にデプロイする。DB変更はプリデプロイで適用される。
コードのロールバックだけでDBの変更は戻らないため、移行前にバックアップを確認する。

## 依存関係と運用上の注意

Next.js 16.4.6、Prisma関連7.10.1、esbuild 0.28.2へ更新した。ExcelJSが使用するuuidはv4のみで、CommonJS互換の11.1.1に固定し、Excelの読み書き・HTTPテストで互換性を検証する。
公開時のログインは社員ID単位の試行回数制限を利用する。全体のリクエスト制限やSSOは未導入のため、利用範囲を広げる際にはアクセス制限を検討する。
