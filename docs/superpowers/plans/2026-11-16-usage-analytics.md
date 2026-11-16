# Usage Analytics Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 部門を扱わない工具使用状況・コスト分析画面を提供する。
**Architecture:** 認証済みサーバーページから期間条件を検証し、Prismaで通常取引を取得して正確な金額集計を行う。既存UIを使い、HTML/CSSグラフとランキングを描画する。
**Tech Stack:** Next.js, React, TypeScript, Prisma, node:test.
**Spec:** `docs/superpowers/specs/2026-11-16-usage-analytics-design.md`

## Global Constraints
- 部門と入数を表示しない。既存マイページと未コミットの工具画面変更を保持する。
- JST、取消除外、保存金額、欠損明示、無効工具の実績を維持する。
- データ変更・追加依存・DBマイグレーション不要。

## Review Focus
- JST日付境界と月末・閏日比較。
- 比較元0円、金額欠損、巨大金額の精度。
- 取消が対象期間外に作成されても元取引を除外。
- 無効工具と旧カテゴリー名も絞り込み対象。
- 不正条件をエラー表示し、全件集計と誤認させない。

### Task 1: 集計と期間
Files: `src/lib/analytics/summary.ts`, `tests/analytics.test.ts`, `scripts/run-typescript.mjs`, `package.json`.
Interfaces: `analyticsFilters(query, now)`, `summarizeTransactions(rows, filters)`.
- [x] 期間・JST境界・比較・精度・欠損・ランキングの失敗テストを書く。
- [x] `npm run test:analytics` が失敗することを確認する。
- [x] 純粋な期間検証・集計処理を実装し、同テストを通す。

### Task 2: データ取得と画面
Files: `src/lib/analytics/read.ts`, `src/app/analytics/page.tsx`, `src/components/analytics-filters.tsx`, `src/components/analytics-results.tsx`, `src/components/workspace-shell.tsx`, `src/app/dashboard/page.tsx`, `tests/analytics-db.test.ts`.
Interfaces: `readAnalytics(db, filters)` returns summary and comparison; page authenticates all-history and price permissions before queries.
- [x] 実DBで取消・調整・権限経由のアクセス・絞り込み・期間を検証するテストを作る。
- [x] テスト失敗を確認してからデータ取得を実装する。
- [x] 4カード・推移・カテゴリー内訳・ランキングと検索条件を実装する。
- [x] メニューとマイページに導線を追加する。
- [x] `npm run test:analytics`, `npm run test:analytics-db`, `npm run typecheck`, `npm run build`, `npm test` を実行。ブラウザで実画面を確認する。
- [x] 差分をレビューし、結果と制限を記録する。

## Execution notes
ユーザーから実装の承認を受けているため、追加承認なしでこのセッション内で実装する。
既存作業のあるチェックアウトを保ち、専用ブランチ `feat/usage-analytics` で作業する。自動コミット・公開は行わない。

## Verification results
- `npm test`: 189件成功、失敗0。新規集計テスト・実DBテスト・既存機能・HTTPテスト・本番ビルドを含む。
- `npm run typecheck` と `git diff --check`: 成功。
- 分離した検証用DBを使ってEdge/Playwrightで操作確認。期間・カテゴリー・工具、金額未登録、空表示、不正期間、匿名アクセス、履歴への遷移を確認。
- 1600px／390pxのスクリーンショットを確認。ページエラー0、モバイルで文書の横はみ出しなし。
- 独立レビューで見つかった未登録金額の表示文字列を修正。未解決の指摘なし。
- 全体テストで発見した前回の入数表示・順序の古い期待値を、新しい仕様に合わせて更新。
