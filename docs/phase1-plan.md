# Phase 1 実装計画・実行記録

基準: ToolStock_Manager_Codex_開発指示.md。初期フォルダーは指示書のみ、Gitなし。

- [x] Next.js/TypeScript/Tailwind、Compose、環境変数、無視設定を作成。
- [x] 13モデル、FK、数量制約、部分一意索引、履歴保護のDDLを作成。
- [x] 架空シードとDB接続確認を作成。
- [x] 専用DB上で初期DDLを検証する結合テストと起動・停止・バックアップ手順を作成。
- [x] 依存取得・lockfile生成済み。Prisma validate/generate、型検査、ビルド成功。
- [x] 本番サーバー起動、トップHTTP 200とDB停止時HTTP 503を確認。
- [x] Compose起動（利用者）、migrate適用と再実行、seed投入と全13テーブルの再実行不変確認、DBテスト1件成功、DB接続API HTTP 200・工具4件を確認。

検証観点: 未適用DDLは503、負在庫・過剰引当・重複コード/リクエスト・FK違反を拒否、履歴改変拒否、seed再実行で既存残高を保持。依存やDBが必要な検証は成功とみなさない。


