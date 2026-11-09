# Data Manager Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 管理者が全15種類のデータを表形式で管理できる環境を提供する。
**Architecture:** 共通の許可リスト定義、一覧サービス、トランザクション更新サービス、管理者専用API、React表編集画面。
**Tech Stack:** Next.js 16 / React 19 / Prisma 7 / PostgreSQL / Tailwind 4。
**Spec:** docs/superpowers/specs/2026-11-09-data-manager-design.md

## Global Constraints

- 管理者専用。追加依存・DB移行なし。秘密情報は表示・監査へ含めない。
- 全15種類。主キー・参照先・コード・日時と監査は表示専用。
- 在庫・履歴・監査の整合性、一括保存の原子性、更新日時による競合検知。

## Review Focus

- 不明テーブル・列と作業者APIアクセスの拒否。
- 一括保存の途中の入力不正と最後の管理者の保護。
- 在庫修正の負在庫・引当割れと履歴訂正の二重実行。
- 表示・API・監査ログへの秘密情報混入。
- ページ移動・検索時の未保存変更、保存失敗時の入力保持。

### Task 1: サービスと権限
- [x] 管理権限の拒否テスト、一覧・保存サービスのテストを追加し失敗確認。
- [x] `src/lib/data-manager/definitions.ts`, `read.ts`, `write.ts`, `service.ts` を実装。
- [x] 全15種類、許可リスト、原子的保存、機密保護、在庫・履歴訂正を検証。

### Task 2: APIと表形式画面
- [x] `/api/admin/data/[table]` のGET/POSTと `/admin/data` を追加。
- [x] 検索・ページング・変更表示・保存・取消と画面離脱時の変更保護。
- [x] 管理者メニュー、戻るリンク、HTTPテストを追加。

### Task 3: 検証と文書
- [x] ビルド、全123テスト、差分検証。権限・競合・ロールバックを再確認。
- [x] 利用方法と保護する項目を `docs/data-management.md` に記録。

## Review and browser validation

レビューで指摘された負数入力は、出庫の数量を文字列 `-3` で保存する回帰テストで修正。ブラウザのBackで入力を失うケースはNavigation APIの遷移取消と非対応ブラウザの同一URLガードで修正し、両経路を実ブラウザで確認。

一時テストDBでセル編集→保存→DB確認、未保存のユーザー名を保持したままBackを取消、375px/1440pxでの表示、出庫数の訂正と在庫反映、監査ログの表示専用を検証。スクリーンショットは `.cache/data-manager-1440.png`, `.cache/data-manager-375.png`。
