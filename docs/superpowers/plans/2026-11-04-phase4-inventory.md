# Phase 4 — 入出庫・取消・履歴の計画

現行仕様は2026-11-07の簡素化を反映する。元のPhase 4実装と当時の検証は完了済み。今回の変更進捗と検証は2026-11-07-simple-inventory.mdで管理する。

**Goal:** 両ロールが在庫を壊さずに入出庫し、管理者が理由付き取消を行い、権限に応じた履歴を参照できるようにする。

## 現行インターフェース

- InventoryService: issue/receive/reverse/listHistory/historyDetail/historyOptions。adjustは提供しない。
- 通常入出庫入力はrequest_key/tool_id/location_id/quantity。reasonは互換入力として任意だがUIに入力欄を設けない。reverseはrequest_key/transaction_id/reasonを要求する。
- issue/receiveは両ロール、reverseはinventory:reverseを持つ管理者。inventory:adjustは廃止する。
- InventoryResultはid/type/tool_id/location_id/actor_user_id/machine_id/quantity/on_hand_before/on_hand_after/reserved/reason/reverses_id/created_at。machine_idは旧確定結果・逆取引との互換用で、新規通常取引はNULL。
- HistoryItemは取引属性とtool/location/actor/reversal_id。machineは公開しない。historyOptionsはtools/actorsだけ。
- 検索はfrom/to（日本時間YYYY-MM-DD）、tool_id、actor_user_id、type、page。非空のmachine_id検索は400。
- 本人履歴は本人のISSUE/RECEIVEとそれらのREVERSAL。管理者は全履歴。
- 廃止前に成功した設備付き要求は同内容再送可能。新規設備指定は400。/inventory/adjust と /api/inventory/adjustは404。

## 維持する保証

在庫不足・引当割れ・整数上限・二重計上を拒否する。users共有ロック→セッション→要求キー→工具行のロック順序、条件付き残高更新、在庫/履歴/監査の原子性、3秒lock_timeout/10秒トランザクション上限を維持する。旧履歴と関連を削除せず、二重取消を一意制約で防ぐ。

## 実装順序

1. 両ロールの入庫・設備なし出庫・本人の入庫履歴・管理者取消・旧再送・廃止経路404をテストへ追加して旧実装で失敗を確認する。
2. 権限、要求正規化、在庫更新、履歴スコープとDTOを変更する。
3. 追加移行でISSUEの設備必須CHECKだけを外し、既存業務データの不変を確認する。
4. 理由/設備入力と棚卸画面/APIを削除し、通常入出庫の数量＋/−・見込み・棚自動選択を維持する。
5. 全テスト・型検査・ビルド・Prisma検証とPC/タブレット幅の入出庫→履歴→取消を確認する。

新しい成功件数と移行適用結果は、実行結果を確認した後に記録する。既存の適用済みSQLは変更しない。
