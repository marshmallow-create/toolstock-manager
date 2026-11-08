# DB設計（2026年11月8日）

構造の正本は `prisma/schema.prisma` と `prisma/migrations/` です。画面仕様は[現行仕様書](specification.md)を参照してください。

## 保存形式と制約

- 主キーはUUID、日時はUTCのtimestamptz(3)、表示時はAsia/Tokyoへ変換します。
- 数量はinteger、金額はDecimal(14,2)。浮動小数点で金額を保存しません。
- 工具コード・社員IDは一意。工具×保管場所の在庫行も一意です。
- 実在庫は非負、0≦引当≦実在庫。単価は非負。安全在庫≦発注点≦目標在庫をDBでも確認します。
- 取引数量は非ゼロ。入庫は正、出庫は負。ADJUSTMENTとREVERSALには理由が必要です。
- 取引キーと取消元IDは一意。部分一意インデックスで工具ごとのOPEN発注候補を最大1件にします。
- 履歴・監査ログはUPDATE/DELETE拒否トリガーで保護します。外部キーはRESTRICT削除です。

カテゴリーと部門の候補制限はアプリの保存・検索検証で行います。DB列は文字列のままなので、直接SQLを使う運用ではアプリを通した入力制限とは別に取り扱う必要があります。

## 主なテーブル

| テーブル | 用途 |
| --- | --- |
| users | 社員ID、氏名、2ロール、有効状態、パスワードハッシュ |
| sessions | 生トークンではなくSHA-256、ユーザー、作成・最終利用・絶対期限 |
| login_attempts | 社員IDハッシュごとの試行回数と15分の窓 |
| tools | 品目コード・名称・カテゴリー・単位・メーカー・型番・単価・部門・棚番・状態 |
| locations | 旧在庫の参照先と工具ごとの内部在庫参照先。独立した管理画面はなし |
| stock_balances | 工具×参照先ごとの実在庫・引当 |
| inventory_policies | 工具全体の安全在庫・発注点・目標在庫 |
| inventory_transactions | 増減数量、操作種別、操作者、取消元、理由、確定残高・単価 |
| reorder_candidates | 発注候補数とOPEN / CONVERTED / DISMISSED状態 |
| audit_logs | 操作者、操作名、対象、変更前後などのJSON |
| machines / suppliers / supplier_items | 旧データと参照整合性の保持。旧単価の読み取り互換 |
| purchase_orders / purchase_order_items | 発注残集計に使用する既存構造。注文ワークフローの画面は未実装 |

新規工具には `@tool/<工具UUID>` の内部参照先を作成します。利用者の棚番は `tools.shelf_code` に保持し、棚番を変更しても在庫行・取引の参照先は変えません。

## 取引と確定値

通常入庫はRECEIVE、通常出庫はISSUE、取消は元の増減と逆符号のREVERSALです。工具編集で在庫を変更した場合は差分をADJUSTMENTとして記録します。独立した棚卸APIは提供しません。

`on_hand_after` は当該在庫参照先の取引直後の実在庫、`unit_price` は取引時点の単価です。取消では元取引の単価を引き継ぎます。未知の旧単価は現在値で補いません。旧残高は対応する監査記録で確認できる場合のみ読み取り時に補います。

通常取引の再送キーは `phase4:<UUID>`、工具編集の在庫修正は `tool-edit:<UUID>`。初期在庫登録にも専用キーがあります。在庫、取引、監査は同じトランザクションで保存し、いずれかが失敗すれば全体を戻します。

## 主な監査イベント

| イベント | 内容 |
| --- | --- |
| SESSION_LOGIN / SESSION_LOGOUT | セッションの生成・削除 |
| USER_CREATED / USER_UPDATED | ユーザー変更。パスワード本文は記録しない |
| TOOL_CREATED / TOOL_UPDATED | 工具と在庫方針の変更前後 |
| INITIAL_STOCK_REGISTERED | 初期在庫の確定・再送判定 |
| TOOL_STOCK_UPDATED | 工具編集での在庫修正、変更前後と取引 |
| TOOL_ORDER_QUANTITY_UPDATED | 発注候補数の変更前後 |
| INVENTORY_MUTATION | 通常取引の要求フィンガープリントと確定結果 |

工具変更履歴はこのうち工具変更に関するイベントから差分を生成します。監査表や取引表を表示件数に合わせて削除することはありません。

## 適用済み移行の構成

| ディレクトリ | 内容 |
| --- | --- |
| 20261103000000_init | 業務テーブル、CHECK、部分一意索引、履歴保護 |
| 20261103010000_auth | パスワード、セッション、ログイン試行 |
| 20261105000000_tool_registration | 部門・工具単価 |
| 20261105010000_two_roles | 2ロール化と対象セッション失効 |
| 20261107000000_simple_inventory | 出庫の設備必須制約を解除 |
| 20261107010000_tool_shelf | 工具ごとの棚番 |
| 20261107020000_history_snapshots | 取引直後の残高・単価と索引 |

既存の移行を書き換えず、変更は追加移行で管理します。PrismaスキーマだけからDBを作り直すとSQL専用のCHECK・部分索引・トリガーが欠けるため、既存移行を適用します。

## 開発・テストデータ

開発DBは `DATABASE_URL`、テストDBは `TEST_DATABASE_URL` を使います。テストはDB名にtestが含まれることを確認し、一時スキーマへ全移行を適用します。

資格情報の初期設定はローカルの `toolstock_dev` と明示的な `ALLOW_LOCAL_SEED=yes` に制限します。パスワードはscrypt、16バイトsaltでハッシュ化します。元のパスワードをDB・監査・文書へ保存しません。

Dockerの `postgres_data` ボリュームを保持します。バックアップはDB全体のダンプを別途取得する必要があります。`.local/development-snapshots/` に保管する古い検証用JSONは一部項目の記録であり、DB全体の復元用バックアップではありません。
