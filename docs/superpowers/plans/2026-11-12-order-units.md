# 発注単位・在庫単位と取引金額 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 箱・袋の発注を個数の在庫に換算し、出庫時マスターによる使用金額を履歴に保存する。

**Architecture:** Toolに発注単位・入数を追加し、単位と価格の換算を共通関数に集約する。軽量なToolOrderと入庫履歴との関連で発注残を管理する。既存の在庫トランザクション・認可・監査・冪等性を拡張し、旧注文と既存Excelの互換性を保つ。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Prisma 7 / PostgreSQL / ExcelJS / node:test。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-11-12-order-units-design.md`

## Global Constraints

- Tool.unitを在庫単位、Tool.unit_priceを発注単位あたりの仕入単価として使う。
- 入数は1～2,147,483,647の整数。数量の積は安全整数かつ在庫数量上限以下で検証する。
- 在庫単価はDecimal(24,8)、取引金額はDecimal(24,2)。価格は既存Decimal(14,2)。金額計算はPrisma.Decimalを使う。
- マスター価格変更で過去履歴・発注残を変えない。取消は元の履歴を反転する。
- 月別グラフ・集計画面と実際の業者への送信は今回の対象外。
- 既存未コミット変更を保持する。実装開始前に最新diffを再確認する。自動コミットや他作業の取り込みはしない。
- 通常利用DBの変更前はバックアップする。テストは専用TEST_DATABASE_URLを使用する。

## Review Focus

- 入数3の割り切れない単価でも3個の取引金額が箱の価格と一致する（Task 1）。
- 価格・入数変更後も既存の発注の換算数量と取消金額を維持する（Task 2, 3）。
- 旧9列Excelを更新に使っても既存工具の入数・単位が初期化されない（Task 1）。
- 部分入庫の同時実行、再送、取消で在庫と発注残の片側だけを更新しない（Task 3）。
- 未設定価格を0円として月別集計へ混ぜず、旧履歴を現在の入数で補正しない（Task 2）。

## Task 1: 工具マスター・換算関数・Excel互換性

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/masters/validation.ts`, `write.ts`, `read.ts`, `tool-import.ts`, `tool-update.ts`, `tool-workbook.ts`, `change-history.ts` in `src/lib/masters/`
- Create: `prisma/migrations/20261112010000_order_units/migration.sql`, `src/lib/inventory/cost.ts`
- Modify: `src/components/masters.tsx`, `tool-import-form.tsx`, `tool-stock-table.tsx`, `src/lib/orders/list.ts`
- Test: `tests/masters.test.ts`, `tests/tool-import.test.ts`, `tests/tool-workbook.test.ts`, `tests/tool-import-http.test.ts`

**Interfaces:**
- `stockQuantity(quantity: number, unitsPerOrder: number): number` rejects overflow with AuthError(400).
- `inventoryCost(price: Prisma.Decimal | null, unitsPerOrder: number, signedQuantity: number): {unit_price: Prisma.Decimal | null; amount: Prisma.Decimal | null}` returns 8-place unit price and 2-place amount computed directly from unrounded ratio.
- Tool adds `order_unit: string`, `units_per_order: number`. New create defaults follow the spec; patch omissions preserve existing values.
- Tool API retains `unit_price` as purchase price and adds derived `stock_unit_price`. Quantity fields include their explicit units in UI.

- [ ] Add failing service tests: create 10個/箱 and 3個/箱; reject 0/negative/fractional units_per_order; change purchase price and retain existing units on omitted fields; prohibit stock-unit edits with stock/history.
- [ ] Add failing workbook tests: 12-column round-trip, new/old 9-column imports, update blanks retain current units, preview detects concurrent pack changes. Preserve ZIP/XML safety limits, derive cell-column bounds from supported header lengths instead of hardcoded A-I/9.
- [ ] Run `node scripts/run-typescript.mjs masters`, `tool-import`, `tool-workbook`, `tool-import-http` and confirm relevant new assertions fail.
- [ ] Add fields and DB CHECK for positive入数; initialize existing order_unit=unit and units_per_order=1 without changing prices or quantities. Implement Decimal helpers and tests for 1000/3×3=1000.00, 1000/3×1=333.33, null/zero/max price and quantity overflow.
- [ ] Extend validation, single-create/edit, audit display, Excel preview/commit/template/export, and forms/tables. Keep old 9-column headers supported. Extend output DTOs so export→update retains all units.
- [ ] Re-run the four targeted tests, Prisma validation and typecheck; inspect diffs against the pre-existing export work.

## Task 2: 全在庫処理の金額固定保存と履歴表示

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/inventory/write.ts`, `read.ts`, `types.ts`, `src/lib/masters/write.ts`, `initial-stock.ts`
- Create: `prisma/migrations/20261112020000_inventory_amounts/migration.sql`
- Modify: `src/components/inventory.tsx`, `src/lib/format-price.ts`
- Test: `tests/inventory.test.ts`, `tests/inventory-http.test.ts`, `tests/masters.test.ts`, `tests/database.test.ts`

**Interfaces:**
- InventoryTransaction.unit_price widens to Decimal(24,8); add `amount Decimal(24,2)?`, `purchase_unit_price Decimal(14,2)?`, `cost_units_per_order Int?`, `stock_unit String?`, `cost_basis String` with LEGACY/MASTER CHECK.
- `HistoryItem` adds `amount?: string | null`, `cost_basis`, `stock_unit`; exact decimal strings travel through DTOs.
- `inventoryCost` from Task 1 supplies all new issue/receive/adjustment/initial-stock writes; reversal copies original snapshots and negates stored amount.
- Add a dedicated money display helper with maximumFractionDigits=2 for inventory prices/amounts, retaining existing unrelated price display rules.

- [ ] Add failing tests: 3個 at 5000/10 => unit_price=500, amount=-1500 on ISSUE; receive => positive amount; 1000/3×3 => -1000; null distinct from zero; max values fit fields.
- [ ] Add failing tests: change master price and pack then cancel; reversal retains original price and returns exact opposite amount; first history stays unchanged; initial-stock and manual adjustment use same calculation.
- [ ] Run inventory and masters tests and confirm new assertions fail.
- [ ] Add migration with legacy basis; derive legacy amounts only from historical saved unit_price×quantity. Do not populate historical pack snapshots from current tools. Reversal pairs must cancel even when migrating historical data.
- [ ] Route every transaction writer through the cost helper. Preserve locking, idempotency and authorization. Expose stored values in history DTO/table including the tool detail's recent history.
- [ ] Add HTTP assertions for amounts, price ranges with >2-digit unit precision, explicit units and legacy/null behavior. Document usage aggregation predicate: ISSUE plus REVERSAL of ISSUE, negate signed amount; do not aggregate every negative stock delta.
- [ ] Run inventory, inventory-http, masters and database tests; verify migration against nonempty legacy fixtures, including unknown prices and reversal pairs.

## Task 3: 発注登録・発注残・紐付入庫

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/orders/list.ts`, `src/app/api/orders/route.ts`, `src/app/orders/page.tsx`
- Create: `prisma/migrations/20261112030000_tool_orders/migration.sql`, `src/lib/orders/write.ts`, `src/lib/orders/read.ts`, `src/components/order-form.tsx`, `src/app/api/orders/[id]/cancel/route.ts`
- Modify: `src/lib/inventory/validation.ts`, `types.ts`, `write.ts`, `src/lib/masters/read.ts`, `src/components/inventory-form.tsx`, `src/app/tools/[id]/page.tsx`, `src/lib/auth/permissions.ts`
- Test: `tests/order-list.test.ts`, `tests/order-list-http.test.ts`, `tests/inventory.test.ts`, `tests/inventory-http.test.ts`, `tests/permissions.test.ts`

**Interfaces:**
- ToolOrder: id, tool_id, created_by, request_key(unique), order_quantity, order_unit, units_per_order, stock_quantity, received_quantity(default 0), cancelled_quantity(default 0), purchase_unit_price(nullable), timestamps. Relations to Tool/User; DB CHECK all counters nonnegative, pack positive, received+cancelled<=stock_quantity.
- InventoryTransaction adds optional tool_order_id and receipt_units_per_order; each linked receipt belongs to one ToolOrder. Its reversal references the original receipt through existing reverses_id.
- `registerOrder(db,auth,token,input)` accepts tool_id, entry_id, quantity, expected_units_per_order, request_key. Save snapshots under tool lock; reject stale preview, zero, overflow, invalid entry/tool. Consume list entry only, retain candidate setting.
- `cancelOrder(db,auth,token,id,input)` cancels only current outstanding remainder, with audit/idempotent request_key. Receipts already stored stay unchanged.
- `orders:manage` permission = ADMIN; workers retain read/receive permissions. POST /api/orders records external-order facts only.
- `openOrders(db,toolId)` returns new unreceived ToolOrders for receipt selection. `on_order` adds these stock-unit remainders to existing legacy purchase-order remainders.
- Receive input adds `quantity_unit: 'stock' | 'order'` (default stock), `tool_order_id?`. Linked order-unit receipts use order snapshot pack; unlinked order-unit receipts use current tool pack. Keep unsupported legacy order_id fields rejected.

- [ ] Add failing service/API tests: 2箱×10 => 20個 on_order and unchanged on_hand; registration snapshot survives pack=3 update; repeated same key returns same result; different content409; worker registration403; candidates unchanged; list entry consumed once.
- [ ] Add failing receipt tests: 1箱 receipt of snapshot pack10 => on_hand+10, remainder10; stock-unit partial receipt3 => remainder7; wrong-tool link400/409; excess receipt409; unlinked receipts don't touch remainder; two concurrent receipts cannot exceed remainder.
- [ ] Add failing cancellation tests: cancel receipt restores same stock-unit remainder exactly once; pending order cancellation preserves received quantity; reversing a receipt after remainder cancellation restores the receipt quantity as outstanding and preserves cancelled quantity; stale/double submits have no duplicate stock effect.
- [ ] Run orders/orders-http/inventory/inventory-http tests and observe new assertions fail.
- [ ] Implement ToolOrder migration, read/write services, atomic receipt/reversal changes using consistent tool→order lock order, and existing auth transactions/audit. Include new receipt fields in normalized fingerprints.
- [ ] Extend order list and detail UI with explicit units, conversion preview, mark-ordered form, pending orders, partial receipt and cancel-remainder form. Existing normal receive and issue flows continue to work with stock quantity as default.
- [ ] Update master-list/detail and order-list threshold aggregates to include new remainders with no second conversion. Keep legacy records separate and unchanged. Keep current threshold comparison as specified.
- [ ] Re-run targeted tests and permissions tests; add rollback tests for audit failure to prove order/stock/history atomicity.

## Task 4: 回帰確認・運用文書

**Files:** `docs/specification.md`, `docs/database.md`, `docs/excel-import.md`, `docs/maintenance.md`, new/updated tests above.

- [ ] Update current docs with field meanings, 9/12-column Excel compatibility, rounding, legacy-history limits, manual external-order recording, receipt selection, backup/migration steps, and monthly aggregation definition.
- [ ] Run `npm run db:validate`, `npm run typecheck`, `npm test`, and `npm run build`. If test DB is unavailable, report that separately; do not label skipped DB tests passing.
- [ ] Start app and verify registration→2箱発注→1箱入庫→3個出庫→price update→出庫取消 with 10個/箱; check history and order remainder in browser/API and DB. Repeat rounding case with3個/箱 and old Excel update.
- [ ] Review permission handling, input limits, stale-preview behavior and null amounts. Apply React checklist for edited TSX components and request final code review through the applicable skill.
- [ ] If applying to normal-use DB, create backup using existing backup script, verify destination, apply additive migrations, compare row counts/prices/stock before and after. Report whether this DB application actually occurred.
- [ ] Report changed behavior, checks run, remaining limitations, and explicit status of normal-use DB. Leave unrelated work intact.

## 実行方法とレビュー状態

利用者が計画とこのセッションでの実装を承認。Task 1～4を実装・検証済み。発注残の読み取りは既存masters/read.tsへ統合し、新たなorders/read.tsは不要と判断した。独立レビューの取消方向表示を修正し、全166件のテスト・型チェック・Prisma検証・実ブラウザ確認を完了。通常利用ローカルDBはバックアップ後に追加3移行を適用し、既存データの照合が成功。コミット・マージ・外部公開は行わずfeat/order-unitsに変更を保持する。
