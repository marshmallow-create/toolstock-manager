# 工具Excel出力 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 検索結果全件を既存の一括変更に使用できるExcelとして出力する。
**Architecture:** 一覧の検索条件を共用し、ページ制限なしで出力用データを取得する。既存変更テンプレートに現在値を入れ、200件超はZIPにまとめる。
**Tech Stack:** Next.js、Prisma、ExcelJS、JSZip、node:test。
**Spec:** ../specs/2026-11-12-tool-excel-export-design.md（利用者承認済み）

## Global Constraints

- 工具変更シート・既存9列を維持する。200件ごとに分割する。
- 利用者の追加指示により出力は `tools:export` 権限で管理者のみに制限。一括変更も管理者のみ。
- DB・資格情報の変更なし。検索条件は全ページに適用する。

## Review Focus

- 先頭0と数式に見える文字列を値として保持する。
- 小数単価の無変更再取込で金額を書き換えない。
- 空結果は説明付き変更テンプレートを返す。
- 201件では2ファイルになり各ファイルを既存パーサーで読める。
- 非表示ページや作業者からの取得でも認可と検索条件を適用する。

### Task 1: 出力ファイルとデータ取得

**Files:** src/lib/masters/read.ts、service.ts、tool-export.ts（新規）、tests/tool-workbook.test.ts、tests/masters.test.ts、package.json、package-lock.json
**Interfaces:** exportTools(db,auth,token,input) は検索全件の現在値を返す。createToolExport(tools) は buffer/contentType/filename を返す。

- [x] 読み戻し、文字列・小数、0件、200/201件、全ページ・検索条件・認可の失敗テストを書く。
- [x] 関連テストで新機能未実装による失敗を確認する。
- [x] 検索条件を共用し、現在値を変更テンプレートへ入力する。JSZipを実行時依存へ移す。
- [x] 関連テストの成功を確認する。

### Task 2: APIと工具一覧

**Files:** src/app/api/tools/export/route.ts（新規）、src/components/tools-list.tsx、tests/tool-import-http.test.ts、docs/excel-import.md、docs/maintenance.md
**Interfaces:** GET /api/tools/export は検索条件を受け、xlsxまたはZIPのattachmentをno-storeで返す。

- [x] API未認証・作業者/管理者・検索・画面リンク・無変更と編集後の再取込テストを書く。
- [x] 新API未実装での失敗を確認し、APIと一覧のダウンロードリンクを追加する。
- [x] 型チェック、全体テスト（ビルド含む）、git diff --check を実行する。
- [x] 文書と進捗を更新し、レビューして結果を報告する。

## 実行記録

承認済み設計に従って現在の作業場所で継続する。変更は未コミットのまま利用者が確認できるようにする。

新機能の失敗テストを確認後に実装し、関連テストが成功。独立レビューで既存カテゴリー・棚番の読み戻しを指摘され、それぞれ失敗する回帰テストを追加してから修正した。再レビューで追加指摘なし。最終の `npm.cmd test` は終了コード0、全154件成功（本番ビルド含む）。型チェック・差分検査も成功。

追加指示で出力を管理者専用に変更。作業者のサービス/API拒否とボタン非表示をテストし、失敗を確認後に権限と表示を修正した。変更後の型チェック・全155件のテスト（本番ビルド含む）が終了コード0。独立レビューでも追加指摘なし。
