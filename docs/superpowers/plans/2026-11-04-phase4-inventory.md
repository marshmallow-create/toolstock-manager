# Phase 4 Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and final superpowers:requesting-code-review. Steps use checkbox syntax for tracking.

**Goal:** 在庫を壊さない手動入出庫・棚卸・逆取引と、権限付き履歴検索を提供する。
**Architecture:** 既存認証に在庫用共有ロックの入口を追加し、工具行・リクエストキーをロックするInventoryServiceを作る。HTML画面/APIは同じサービスを利用する。
**Tech Stack:** 既存Next.js/React/Prisma/PostgreSQL。依存・DDL追加なし。
**Spec:** docs/superpowers/specs/2026-11-04-phase4-inventory-design.md（実装・テスト承認済み）

## Global Constraints
- 専用TEST_DATABASE_URLの一時スキーマのみでデータ検証する。開発用資格情報を読まない。
- Phase 3の37テストを維持し、Phase 5の発注機能を先行実装しない。
- 数量はPg整数の範囲内、理由は1〜500文字。操作者はセッションから決める。
- users SHARE → sessions更新 → request advisory lock → tool FOR UPDATE → balance更新・履歴・監査。管理処理は既存のusers SHARE ROW EXCLUSIVEを維持する。
- 同キー・同内容・同操作者は同じ確定結果。権限失効や異内容は拒否する。
- DB履歴/監査の追記専用制約を維持。削除・直接編集は提供しない。
- 変更は既存フォルダー内に保持し、自動コミット・push・デプロイを行わない。

## Review Focus
- 同時出庫でavailable割れ、残高加算で整数上限超過、棚卸で期待値を無視する破損。
- request_keyを別操作・別数量・別操作者・別工具へ使い回す二重処理。
- 取消の権限、二重取消、消費済み入庫の取消、無効マスタの取消。
- 本人履歴・その管理者による取消を正しく公開し、他人のID直指定や工具直近履歴を隠す。
- 日本時間境界・実在しない日付・50件ページング・同時刻の順序。

## 固定インターフェース（並行作業の境界）

src/lib/inventory/service.ts の InventoryService(db)：
- issue(token,input), receive(token,input), adjust(token,input), reverse(token,input): Promise<InventoryResult>
- listHistory(token,query={}): Promise<{items:HistoryItem[];total:number;page:number;pageSize:number}>
- historyDetail(token,id): Promise<HistoryItem & {confirmation?:InventoryResult}>
- historyOptions(token): Promise<{tools:{id,tool_code,name,active}[];machines:{id,machine_code,name,active}[];actors:{id,employee_code,name,active}[]}>
tokenはstring|undefined、input/queryはRecord<string,unknown>。
入力はrequest_key、tool_id、location_id、quantity（issue/receive）、machine_id（issue）、reason（issue任意・他必須）、counted_quantity/expected_on_hand/expected_reserved（adjust）、transaction_id/reason（reverse）。
検索はfrom/to（日本時間YYYY-MM-DD）、tool_id、machine_id、actor_user_id、type、page。
InventoryResultはid、type、tool_id、location_id、actor_user_id、machine_id:string|null、quantity、on_hand_before、on_hand_after、reserved、reason:string|null、reverses_id:string|null、created_at:ISO文字列。
HistoryItemはid、type、quantity、reason:string|null、created_at:Date、reverses_id:string|null、reversal_id:string|nullと、tool:{id,tool_code,name,unit,active}、location:{id,location_code,name,active}、actor:{id,employee_code,name,active}、machine:{id,machine_code,name,active}|null。

## Task 1: コアサービス・実DBテスト（親担当）
**Files:** src/lib/auth/service.ts, src/lib/auth/server.ts, src/lib/inventory/{types,validation,write,read,service}.ts, tests/inventory.test.ts, scripts/run-typescript.mjs, package.json。
- [x] 既存37テストを先に検証する。Dockerが利用できなければ起動を試み、阻害要因を報告しつつ実装を続ける。
- [x] サービステストを先に書き、未実装のREDを確認する。
- [x] 固定インターフェースを実装する。auth.inventoryAuthorizedを追加し管理側の挙動を維持する。
- [x] mutateの結果へredirectToを追加し、errorPathにbodyを受ける関数も許可する。既存文字列引数を互換維持する。エラーURLはsearchParams.setで構築する。
- [x] node scripts/run-typescript.mjs inventory：残高/再送/競合/逆取引/権限/日付/監査失敗の検証が成功する。

## Task 2: API・画面・HTTPテスト（別担当、専有ファイル）
**Files:** src/lib/inventory/server.ts, src/app/api/inventory/**, src/app/api/history/**, src/app/inventory/**, src/app/history/**, src/components/inventory*.tsx, tests/inventory-http.test.ts, src/app/tools/[id]/page.tsx, src/app/dashboard/page.tsx, src/app/page.tsx。
上記専有ファイルだけを編集し、Task 1担当ファイルと文書・package.jsonを変更しない。
- [x] 新規API/画面のHTTPテストを先に書き、可能なら404のREDを確認する。ビルド/サーバー実行は親の調整に従う。
- [x] 承認済み設計の全APIと画面を実装する。API成功JSONは{transaction:InventoryResult}、一覧はサービス結果そのまま、詳細は{transaction:HistoryItem}。
- [x] フォーム成功は結果の履歴IDへ303。InventoryService操作の結果をmutateへ渡す際redirectToを設定する。errorPathはbodyから選択工具を保持する関数を使える。
- [x] 工具詳細の直近5件はlistHistory(token,{tool_id:id})から本人制約付きで取得。全量取消フォームは履歴詳細へ置く。
- [x] 数量＋/−、見込み、設備必須、1棚の自動選択を小さなクライアントフォームで実装する。
- [x] node scripts/run-typescript.mjs inventory-http：匿名/全ロール/Origin/保存/再送/逆取引/本人履歴/実フォームの検証。

## Task 3: 統合・レビュー・ブラウザ・文書（親担当）
- [x] npm testへ追加サービス/HTTP検証を組み込み全件を実行する。npm run typecheck/db:validateも成功させる。
- [x] 新規レビュー担当へ全差分を読み取りレビュー依頼し、重要な指摘をRED→GREENで修正する。
- [x] PC/タブレット幅で出庫→履歴→逆取引、入庫、棚卸、再送・入力制約をブラウザ検証する。
- [x] README/AGENTS/requirements/architecture/database/decisionsと本書に実測結果を記載する。
- [x] git diff --check、秘密情報・生成物がコミット候補に混入していないことを確認する。
