# 構成

業務上の基準は[仕様](specification.md)、保存構造は[DB](database.md)、起動手順は[README](../README.md)です。

## 構成と責務

Next.js 16.1.6 App Router、React 19.2.4、TypeScript 5.9.3、Tailwind CSS 4.1.18、Prisma 7.3.0、PostgreSQL 17を使用します。DBにはpgアダプターで接続します。

```text
ブラウザ
  ↓ Server Components / Client Components
Next.js Route Handlers（HTMLフォーム・JSON・multipart）
  ↓ セッション認証・権限・Origin確認
AuthService / MastersService / InventoryService / 発注処理
  ↓ Prisma + pg
PostgreSQL
```

| 場所 | 責務 |
| --- | --- |
| `src/app/` | 画面、API、共通CSS |
| `src/components/workspace-shell.tsx` | 共通枠、上段のブランド・ログイン情報・ログアウト |
| `src/components/dashboard-menu.tsx` | 開閉メニュー、残っている発注の件数警告 |
| `src/components/tools-list.tsx` / `tool-stock-table.tsx` | 検索・ページ切り替え、共通の工具表 |
| `src/components/masters.tsx` | 工具登録・編集、共通入力・保存通知 |
| `src/components/inventory-form.tsx` / `inventory.tsx` | 入出庫の数量・見込み、履歴表・取消 |
| `src/components/order-form.tsx` | 発注済みへの登録・一覧の取消 |
| `src/components/tool-import-form.tsx` | 共通テンプレート、モード選択、確認・一括確定 |
| `src/lib/auth/` | 認証、ユーザー管理、パスワード、権限、HTTP共通処理 |
| `src/lib/masters/` | 工具の検証・検索・変更・初期在庫・変更履歴・Excel |
| `src/lib/inventory/` | 在庫処理、履歴検索、金額計算、発注ライン判定 |
| `src/lib/orders/` | 発注一覧、確認・取消の書き込み |
| `src/lib/tool-options.ts` / `format-price.ts` | 選択候補、表示名、金額表示 |
| `src/lib/db.ts` | Prisma生成クライアントの生成と開発時キャッシュ |
| `prisma/` | 現行スキーマ、適用順を保つ移行、架空シード |
| `scripts/` | 検証実行、バックアップ、ローカル資格情報設定 |
| `tests/` | 専用DBでの移行・業務・HTTPテスト |

## 認証と入力

画面は `pageUser()`、サービスはAuthServiceで認証・認可します。発注の確認は `orders:confirm` を両ロールへ、発注済みの未入庫取消は `orders:manage` を管理者へ許可します。

`mutate()` がOrigin、JSON／フォーム、入力サイズ8KiB、エラー応答、303転送を共通処理します。Excelのmultipartは別途ファイル上限を検査します。APIの読み取りはno-storeです。監査JSONや資格情報をそのまま画面へ渡しません。

DBクライアントは接続URLと生成クライアントのコンストラクターが一致する場合だけ再利用します。スキーマ変更後に古い生成クライアントを使い続けないための処理です。

## 保存と競合

工具保存・ユーザー管理は `authorized()`、入出庫・発注は `inventoryAuthorized()` を通します。保存と監査は同一トランザクションです。

入出庫・発注はユーザーロック、リクエストキーのアドバイザリロック、工具行ロックを使用します。在庫は変更前の残高・引当数を条件に更新します。工具編集は `expected_on_hand` を照合します。入出庫系のロック待ちは3秒、トランザクション上限は10秒です。競合は409として再確認を求めます。

入庫は古い発注から消し込み、割り当てた発注IDと数量を監査に記録します。取消はその割り当てを復元します。入出庫・監査は追記型です。元取引の数量・金額を書き換えません。

Excelの確認は保存せず、変更時には工具・残高・発注ライン・発注数と入力の指紋を `previewToken` にします。確定時に再照合し、全行を共通の工具保存処理で更新します。

## 互換性と整理

現行の発注集計は `tool_orders` に統一しています。旧購買テーブル・安全在庫・目標在庫は追加移行で監査へ退避します。適用済みの移行と過去スキーマの移行テストは保持します。

旧Excelの9列・12列、旧「単価」見出し、旧モード別シートを読み込めます。成功済みの旧要求は監査を使って再送できます。新しい設備指定・旧発注書への入庫指定は受け付けません。

在庫方針は発注ラインだけを保持します。内部の棚・引当数・入数スナップショットは、在庫保護と履歴・計算の整合性に必要なので維持します。
