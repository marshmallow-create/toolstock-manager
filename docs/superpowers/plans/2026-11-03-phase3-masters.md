# Phase 3 Masters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 工具検索、マスタ管理、購買条件、棚別在庫、再送に強い初期在庫登録を提供する。

**Architecture:** 既存のAuthServiceに権限付きトランザクション入口を加える。MastersServiceを入力検証・読取・書込・初期在庫処理に分け、Route HandlersとServer Componentsから利用する。

**Tech Stack:** 既存のNext.js 16.1.6 / React 19.2.4 / Prisma 7.3.0 / TypeScript 5.9.3 / PostgreSQL 17。依存追加なし。

**Spec:** `docs/superpowers/specs/2026-11-03-phase3-masters-design.md`（利用者が実装・テストを承認済み）

## Global Constraints

- ローカル架空データのみ。専用テストDBの一時スキーマを使い、開発DBの残高を変更しない。
- 既存DDL・CHECK・部分一意索引・履歴保護を維持する。コードは正規化後ユニーク、登録後変更不可。
- 数量は整数、単価はDecimal文字列、UTC保存・Asia/Tokyo表示。
- 全書き込みにOrigin検証・DBセッション・権限・同一トランザクション監査。
- 初期在庫は未登録の工具×保管場所に一度だけ。0も登録済み扱い。同一キー再送は権限確認後に元の結果を返す。
- 作業者へ仕入先条件・単価を返さない。管理者だけが閲覧・編集できる。
- ユーザー管理・マスタ書き込みはusersテーブルロック→sessions更新の順序を共有する。
- 自動コミット・外部デプロイ・送信は行わない。

## Review Focus

- 空文字、boolean、小数、指数、PostgreSQL整数/Decimalの境界値の拒否 → Task 1。
- 同一リクエストキーを別工具/別数量/別操作者へ転用しても再計上しない → Task 1。
- 無効化後の成功済み再送と、失効/権限喪失後の再送の違い → Task 1。
- 作業者向けHTML/JSONへ購買条件が混入しない → Task 2/3。
- 初期登録とユーザー変更の同時処理、監査失敗時の全ロールバック → Task 1。

## Task 1: マスタ・在庫サービスとDB検証

**Files:** `src/lib/auth/service.ts`, `src/lib/masters/{validation,read,write,initial-stock,service}.ts`, `tests/masters.test.ts`, `tests/helpers/database.ts`, `scripts/run-typescript.mjs`, `package.json`。

**Interfaces:** `AuthService.authorized<T>(token, permissions: string[], operation: (tx, actor) => Promise<T>): Promise<T>`。`MastersService(db)` は `listTools(token, query)`, `toolDetail(token,id)`, `listMasters(token,kind)`, `createTool/updateTool`, `createMaster/updateMaster`, `saveSupplierItem(token,toolId,conditionId|undefined,input)`, `registerInitialStock(token,toolId,input)` を提供する。入力はRecord<string,unknown>、検索も同じ型。kindはmachines/locations/suppliersのみ。

- [x] 実DBの隔離ヘルパーと失敗するサービス検証を先に追加する。新サービス未実装でのREDを確認する。
- [x] 入力検証・認証付きトランザクション・監査・検索DTO・購買条件・初期在庫を実装する。
- [x] `node scripts/run-typescript.mjs masters`。期待: 登録/検索/重複/数値/権限/再送/同時実行/ロールバックが成功する。

## Task 2: APIとHTTP検証

**Files:** `src/app/api/tools/**/route.ts`, `src/app/api/masters/**/route.ts`, `src/lib/masters/server.ts`, `tests/masters-http.test.ts`。

**Interfaces:** Task 1のMastersServiceを利用。GETはno-store、JSON書込201/200、フォーム303。`mutate` の既存エラー応答を共有する。

- [x] API401/403/404/409、Origin、作業者の購買条件非公開、初期在庫再送のHTTPテストを追加してREDを確認する。
- [x] 承認済み設計の全APIを実装する。allowlistのkindとUUIDを検証する。
- [x] 本番ビルド後 `node scripts/run-typescript.mjs masters-http`。期待: HTTP検証成功。

## Task 3: 画面と導線

**Files:** `src/app/tools/**/page.tsx`, `src/app/admin/masters/page.tsx`, `src/components/masters.tsx`, `src/app/dashboard/page.tsx`, `src/app/page.tsx`, `tests/masters-http.test.ts`。

**Interfaces:** Task 1のサービスとTask 2のフォームPOST先を利用する。入力は日本語ラベルと制約、エラー/成功表示、戻る導線を持つ。

- [x] 検索画面・詳細・権限別フォーム・マスタ画面・実フォーム保存のHTTPテストを追加しREDを確認する。
- [x] サーバーレンダリングで画面を実装。50件ページング、状態絞込、棚別残高、Decimalの文字列表示を行う。
- [x] `npm.cmd run typecheck` とHTTP検証。期待: 型エラーなし、検索とフォーム操作が成功する。

## Task 4: 総合検証と文書

**Files:** `package.json`, `markdown/{README,AGENTS}.md`, `docs/{requirements,architecture,database,decisions}.md`, 本設計・計画。

**Interfaces:** 新規コマンド `test:masters`, `test:masters-http` をnpm testに組み込む。型検査は新規クローンでnext-env.d.tsがなくても動く準備を含む。

- [x] `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run db:validate` を実行。期待: 既存/追加テスト・型検査・ビルドがすべて成功。
- [x] 実装と検証結果・制限を文書化する。
- [x] 新しいレビュー担当者にコード全体をレビュー依頼し、重要な指摘を修正・検証する。
- [x] `git diff --check` と秘密情報の追跡混入がないことを確認し、結果を日本語で報告する。
