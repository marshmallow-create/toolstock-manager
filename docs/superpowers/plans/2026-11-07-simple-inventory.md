# 入出庫機能の簡素化（2026-11-07）

利用者の指示: ログインした全ユーザーが入出庫可能。理由付き手動入庫、棚卸、設備/仕入先とその管理を廃止。関連コード・テスト・Markdownを現行仕様へ合わせる。既存履歴は保持する。

## 現行仕様
- WORKER/ADMINともinventory:read/issue/receive/history:own。ADMINは全履歴、工具/保管場所、ユーザー管理、取消。
- inventory:adjustを廃止し、取消はinventory:reverseへ分離する。
- ISSUE/RECEIVEの画面は工具・保管場所・数量のみ。入庫理由は不要、出庫設備も不要。通常取引の理由は互換入力として任意で受理するが画面に入力欄は出さない。
- ISSUEのmachine_idは新規にはNULL。既存の機器付き要求の成功済み再送は元の内容を照合して返せる。未処理の新規要求でmachine_idを指定した場合は400。
- /inventory/adjustと/api/inventory/adjustを削除し404。過去のADJUSTMENT履歴と逆取引は維持する。
- 設備/仕入先のCRUD、購買条件のCRUD/画面を削除し、該当APIは404。保管場所の管理は/admin/mastersで継続し、名称は「保管場所管理」とする。
- tools.unit_priceを単価の正本にし、既存の単価未設定品だけ旧優先仕入先の単価を読み取り互換で補う。仕入先情報はDTOへ出さない。
- 既存のMachine/Supplier/SupplierItem等のDBモデル・行・FKは過去データ維持のため保持し、新しいアプリ操作からは編集しない。シードでは設備・仕入先・購買条件を作らず、工具単価を直接設定する。
- 本人履歴は本人のISSUE/RECEIVEと、それらのREVERSAL。history:allはADMINのみ。設備フィルター/選択肢/表示を廃止する。machine_idの検索入力は400。
- InventoryResult.machine_idは旧確定結果との互換で保持（新規通常取引はNULL）。HistoryItemのmachineは廃止し、historyOptionsはtools/actorsのみ返す。
- 理由付きの逆取引は誤操作の取消としてADMINだけが利用可能。棚卸操作とは独立する。

## 担当とインターフェース
親: auth/permissions、lib/inventoryのtypes/validation/write/read/service/server、追加SQL移行、seed、package/scripts、総合検証/ローカルDB適用。
画面/マスタ担当: src/app/**（ホームの既存/login開始変更は維持）、src/components/**、src/lib/masters/**、src/lib/inventory/server.ts。authとlib/inventoryの他ファイルは変更しない。親はinventory/serverを編集せず、担当側でActionからadjustを除く。
テスト担当: tests/**のみ。新規シード/移行・全ロールの理由なし入庫/設備なし出庫・廃止API404・取消権限・本人の入庫履歴/取消を検証する。
文書担当: 既存docs/**/*.md、markdown/**/*.mdのみ。本計画は親が管理する。
全員、他担当のファイルを編集しない。Nextの共有build/typegen/サーバー実行は親だけが調整する。テスト担当は親のclient生成後にDBテスト可能。

## 手順
- [x] 新仕様のテストを先に書き、旧実装で失敗することを確認する。
- [x] 権限・入力・履歴・DB CHECKを更新し、在庫不足/数量上限/競合/再送の保証を維持する。
- [x] 不要な画面/API/サービスを削除し、保管場所と工具単価へ整理する。
- [x] 全Markdownの現行仕様を更新する。過去の移行SQLは変更しない。
- [x] 全テスト、型検査、本番ビルド、Prisma validateを実行する。
- [x] 追加移行をローカルDBへ適用し、業務データが変わらないことを確認する。
- [x] 独立レビューとPC/タブレット幅での入庫/出庫/取消/廃止画面404を確認する。
- [x] 差分を検査して未コミットで報告する。

初期状態: src/app/page.tsxとmarkdown/README.mdに/login開始の未コミット変更あり。維持する。新規依存・本番・外部送信・自動コミットは行わない。

## Verification
- npm.cmd test: 78 passed, 0 failed (production build included).
- npm.cmd run typecheck / db:validate: passed.
- DB migration deployed locally; all rows and hashes unchanged across 13 tables.
- Chromium: WORKER issue/receive, ADMIN reverse, same-key replay and own-history visibility passed; retired routes 404.
- PC 1440px / tablet 768px: 8 screens without document overflow, screenshots inspected.
- Isolated seed repeated twice: stock unchanged, direct tool price, no equipment/supplier/conditions recreated.
- Independent core/UI review: no concrete findings. Changes remain uncommitted.
