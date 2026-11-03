# DB設計

正本: prisma/schema.prisma と prisma/migrations/20261103000000_init/migration.sql。主キーUUID（Prismaで生成）、時刻timestamptz(3)、金額numeric(14,2)、数量integer。

## モデル

| モデル | 役割 |
| --- | --- |
| users | 社員コード一意、4ロール、無効化。認証資格情報はPhase 2 |
| tools / machines / locations / suppliers | 工具・設備・棚・仕入先。コード一意、active保持 |
| stock_balances | 工具×棚一意、実在庫・引当 |
| inventory_transactions | 符号付き数量。出庫は負数、入庫は正数。操作者必須、出庫時設備必須。逆取引は元取引と理由必須 |
| inventory_policies | 工具全体で1件。安全在庫≦発注点≦目標 |
| supplier_items | 工具×仕入先一意。単価・入数・納期。優先仕入先は工具につき最大1件 |
| purchase_orders | 発注番号、依頼者、承認者、状態、注文確定日時 |
| purchase_order_items | 注文数・累計受入数、単価・型番・入数・納期のスナップショット |
| reorder_candidates | 工具単位の候補。OPENは工具につき最大1件 |
| audit_logs | 操作者、対象、JSON詳細。追記専用 |

全FKはRESTRICT削除。履歴と監査ログはUPDATE/DELETE拒否トリガーで保護。工具/操作者/設備×履歴時刻、注文状態×作成時刻に索引。訂正取引の元IDは一意として二重取消を防ぐ。

在庫は棚別、発注判定は工具全体の残高合算。on_orderはORDERED/PARTIALLY_RECEIVEDの注文数−受入数から集計予定。APPROVED/EXPORTEDは注文残に含めず、出力だけで注文確定しない。

CHECK制約: 在庫非負、引当≦実在庫、閾値順序、単価非負、入数正数、納期非負、注文数量正数、受入数0以上注文数以下、取引数量非ゼロ。部分一意索引とトリガーはSQL専用のため今後の差分生成時に維持する。

訂正理由、逆取引と原取引の工具/棚/数量の照合、注文状態遷移、権限、在庫と履歴の原子更新はPhase 2〜5のサーバー処理で保証する。納品受入の明細・注文ひも付け、取消残数、返品はPhase 4〜5で拡張する。現段階で入出庫APIは提供しない。

## Phase 2の追加

users.password_hash（nullable）とsessions、login_attemptsを追加。既存マイグレーションを変更せず20261103010000_authで追加。sessionsはトークンのSHA-256を主キーとし、ユーザーFK、作成/最終利用/絶対期限を保持。login_attemptsは社員IDのハッシュをキーとし、試行数と窓の開始日時を保持し、行ロックを伴うupsertで同時試行を制御する。ユーザーの無効化/降格/パスワード変更時にセッションを削除。ユーザー本体や業務履歴は削除しない。

管理変更と成功の監査ログは同一トランザクション。scryptのパラメータはN=32768/r=8/p=1、16バイトsalt、64バイト鍵。パスワード設定は12〜128文字。失効したセッションの定期削除は後続運用整備で追加する。
