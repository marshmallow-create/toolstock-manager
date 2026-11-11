# 構成

業務仕様は[現行仕様書](specification.md)、起動・検証は[README](../README.md)を参照してください。

## 技術構成

Next.js 16.1.6 App Router、React 19.2.4、TypeScript 5.9.3、Tailwind CSS 4.1.18、Prisma 7.3.0、pg、PostgreSQL 17を使用します。依存はpackage-lock.jsonで固定します。外部の認証・データサービスは使いません。

```text
ブラウザ
  ├─ Server Components：画面と権限別データ
  └─ Client Components：メニュー・数量変更と見込み表示
            ↓ HTMLフォーム / JSON
Next.js Route Handlers
            ↓ 認証・認可・Origin確認
AuthService / MastersService / InventoryService
            ↓ Prisma + pgアダプター
ローカルPostgreSQL
```

## ディレクトリと責務

| 場所 | 内容 |
| --- | --- |
| `src/app/` | ページ、APIルート、共通CSS |
| `src/components/workspace-shell.tsx` | 認証済み画面の枠・ログイン情報・戻る導線 |
| `src/components/dashboard-menu.tsx` | マイページの開閉メニュー |
| `src/components/tools-list.tsx` | 工具検索・ページ切り替え |
| `src/components/tool-stock-table.tsx` | 一覧と詳細で共通の工具表 |
| `src/components/masters.tsx` | 工具登録・変更、共通入力・通知 |
| `src/components/tool-option-fields.tsx` | カテゴリー・部門の選択欄 |
| `src/components/inventory-form.tsx` | 入庫・出庫の数量と見込み |
| `src/components/inventory.tsx` | 入出庫履歴の表・日時・取消フォーム |
| `src/lib/auth/` | パスワード、セッション、権限、ユーザー管理、リクエスト処理 |
| `src/lib/masters/` | 工具の検証・参照・保存・初期在庫・変更履歴 |
| `src/lib/masters/tool-import.ts` | 一括行検証・重複検出・全件一括保存 |
| `src/lib/masters/tool-update.ts` | 既存工具の一括変更検証・変更前後の確認・指紋照合・全件一括変更 |
| `src/lib/masters/write.ts` | 通常変更・一括変更で共用する `updateToolInTransaction` と在庫・候補・監査の保存 |
| `src/lib/masters/tool-workbook.ts` | 登録・変更モードの.xlsx生成・解析、yauzlとsaxesによる展開量・XML検査 |
| `src/lib/masters/import-request.ts` | 通常の入力サイズ上限から分離したmultipart受付 |
| `src/components/tool-import-form.tsx` | 登録・変更の切り替え、ファイル選択・変更前後の確認表・確定。Excel処理はサーバーで行う |
| `src/lib/inventory/` | 入出庫・取消・履歴の検証と処理 |
| `src/lib/orders/list.ts` | 発注リストのページ切り替えと権限付き参照 |
| `src/app/orders/` / `src/app/api/orders/` | 発注リスト画面と参照API |
| `src/lib/tool-options.ts` | カテゴリーと部門の候補、表示名と保存コードの対応 |
| `src/lib/db.ts` | DBクライアントの生成・開発時キャッシュ |
| `prisma/` | スキーマ・追加移行・架空シード |
| `scripts/` | テスト用TypeScript実行、開発用資格情報の初期設定 |
| `tests/` | 権限・移行・DB・認証・工具・入出庫・HTTPテスト |

ログインは独立した中央カードを使用します。その他の描画ページはWorkspaceShellを使います。独立した履歴詳細画面はなく、取消操作は履歴一覧内にあります。

## サーバーの入口

画面は `pageUser()`、APIはAuthServiceで実セッションと権限を確認します。`mutate()` はOrigin、8KiBの入力サイズ、JSON/フォーム形式、応答と303転送を共通処理します。読み取り結果はキャッシュさせません。

サービス層は画面とAPIで共用します。認可済みDTOだけを画面へ渡し、監査のJSONや資格情報をそのままクライアントへ渡しません。単価の表示と範囲検索は両ロールに `prices:read` で許可し、工具情報の変更権限とは分離します。

金額は表示時だけ1円単位に四捨五入し、小数を表示しません。DBの `Decimal(14,2)` と小数部2桁以内の入力を保持します。Excelテンプレートの単価列も `numFmt: '0'` とし、解析では小数を切り捨てません。

管理者専用の `/tools/import` は新規登録・既存変更を同じ画面で選びます。テンプレートは同じ9列の「工具登録」「工具変更」で、変更は品目コードをキーに空欄以外だけを反映します。部門・棚番の空欄も保持し、0は明示的な変更値です。両モードとも200件・2MiBを上限とします。テンプレートGETの `mode=update` は `toolstock-update.xlsx`、取り込みPOSTはmultipartの `mode`・`action`・`file` と変更確定用 `previewToken` を受け取ります。mode省略時はcreateです。

## トランザクションと競合

- 管理・工具保存は `AuthService.authorized()` を使い、ユーザー管理との整合性を保ちながら認可・保存・監査をまとめます。
- 工具変更は工具行をロックします。在庫修正は確認時の残高を条件に更新し、フォームの変更前在庫とも照合します。
- Excel一括変更は `tool-update.ts` で変更前後を確認し、工具・全在庫・在庫方針・OPEN候補と解析したファイルの指紋を `previewToken` で照合します。確定時の状態が異なる場合は409で再確認を求めます。全行を1トランザクションにまとめ、共通の `updateToolInTransaction` で在庫差分・発注候補・監査・工具変更履歴を保存します。途中失敗は全件を戻します。
- 入出庫は `inventoryAuthorized()` を使い、ユーザーの共有ロック、リクエストキーのアドバイザリロック、工具行ロック、在庫更新の順で処理します。
- 入出庫のロック待ち上限は3秒、業務トランザクションの実行上限は10秒。同じ要求の再送は成功済み結果を返します。
- 既存の内部在庫参照先と履歴IDは保持します。棚番の表示変更で在庫を別の行へ移しません。

## 工具変更履歴

`src/lib/masters/change-history.ts` が `TOOL_UPDATED`、`TOOL_STOCK_UPDATED`、`TOOL_ORDER_QUANTITY_UPDATED` を読み、表示用の差分へ変換して最新3件を返します。単価の金額は権限に応じて除きます。同じ保存に対する別イベントを1行へ統合する実装ではありません。

## 今後の変更時に確認する箇所

| 変更内容 | 同時に確認するもの |
| --- | --- |
| 画面・入力欄 | 仕様書、共通コンポーネント、サーバー検証、HTTPテスト |
| ロール・権限 | permissions.ts、ページ、API、サービスの認可、権限テスト |
| カテゴリー・部門 | tool-options.ts、保存・検索の検証、既存値の扱い |
| 在庫・取消 | DB制約、ロック順、再送、監査、単価・残高スナップショット |
| DB構造 | 追加移行、生成クライアント、テストDDL、既存データ互換 |

`.cache/` はテストバンドルや検証用の一時ファイルです。削除後は必要に応じて再生成されます。`.next/` は本番ビルドと開発サーバーが使用します。キャッシュを除去するときは対象のサーバー・検証を停止し、稼働中のファイルを削除しません。
