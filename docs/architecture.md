# 構成

Next.js App Routerのサーバー処理からPrisma Clientとpgアダプターを通してローカルPostgreSQLへ接続する。DBクライアントは遅延生成し開発中の再ロードでプールを増やさない。接続タイムアウト3秒。ブラウザへ資格情報を送らない。

トップ画面は静的な案内、GET /api/health/dbのみ読み取り確認。SELECT 1に加えて工具テーブルを読み、未適用マイグレーションも検出する。認証未実装のためローカルに限定して起動する。

Next.js 16 / React 19 / Tailwind 4 / Prisma 7。Prisma 7では接続URLとseedをprisma.config.tsへ分離し、生成先をsrc/generated/prismaとしpgアダプターを使用する。依存は完全固定、npm経由の実互換性とlockfile生成は環境制限解除後に確認する。

公式参照（2026-11-03確認）:
- https://nextjs.org/docs/app/getting-started/installation
- https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7
- https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding

業務書き込み経路は未実装。Phase 2でアプリDBロールとマイグレーション管理者を分離し、必要最小権限を設定する。Composeの所有者資格情報は開発専用で、本番用ではない。

## Phase 2

認証は外部サービスを使わず、src/lib/auth/crypto.ts（暗号処理）、permissions.ts（仕様の権限表）、service.ts（DBセッション・管理トランザクション）、server.ts（Next.jsのCookie/Origin/ページ・API応答）に分離。ブラウザへ渡すユーザーDTOはid/社員ID/氏名/ロール/activeのみ。各ページ・ルートで認証・認可する。Cookieの存在だけで許可しない。ダッシュボードは権限の案内を表示し、業務操作は後続フェーズに残す。

## Phase 3

画面は /tools、/tools/new、/tools/[id]、/tools/[id]/edit、/admin/masters。既存と同じServer Components・HTMLフォーム・Route Handlersを使い、クライアント状態管理や依存パッケージは追加しない。

src/lib/masters/ は validation.ts（型・長さ・数値・UUID・業務コード）、read.ts（検索・棚集計・権限別DTO）、write.ts（マスタ・在庫方針・購買条件と監査）、initial-stock.ts（初期在庫・再送・競合）、service.ts（呼び出し入口）、server.ts（ページ/API用アダプター）に分離する。認可はAuthServiceに統一し、Originとフォーム/JSON応答は既存のmutateを利用する。

AuthService.authorizedは usersテーブルのSHARE ROW EXCLUSIVEロック→セッション検証/更新→権限確認→業務処理の順で実行する。既存ユーザー管理も同じ入口を使う。初期在庫は追加でstock_balancesをロックし、キー照合から残高・履歴・監査まで一体で処理する。これは低頻度の管理処理向けであり、Phase 4の高頻度出庫は別途ロック範囲を設計する。

購買条件は閲覧権限のあるリクエストでのみDBから取得し、作業者向けHTML/JSONへシリアライズしない。GETはno-store。単価はDecimalから小数2桁の文字列へ変換する。更新で許可した業務項目だけをDBへ渡し、操作者や残高の任意指定は採用しない。
