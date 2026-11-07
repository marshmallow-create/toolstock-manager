# Phase 3 — 工具・保管場所・在庫マスタ設計

2026-11-07の利用者指示を反映した現行仕様。過去の実装・検証記録はdecisions.md、今回の変更計画は../plans/2026-11-07-simple-inventory.mdを参照する。

## 対象と権限

工具検索、工具・保管場所の管理、在庫方針、棚別在庫、初期在庫登録を提供する。設備・仕入先・購買条件の画面・登録・更新は廃止する。既存データと参照は削除しない。

在庫参照は作業者（WORKER）と管理者（ADMIN）の両方。工具・保管場所・単価・初期在庫の管理はmasters:writeを持つ管理者だけとする。通常入出庫は両ロールが行い、詳細はPhase 4設計書に従う。単価を作業者向けHTML/JSONへ含めない。

## 画面

| URL | 内容 | 権限 |
| --- | --- | --- |
| /tools | 工具番号・名称・型番の検索、分類・有効状態、50件ページング | inventory:read |
| /tools/new | 工具と在庫方針、部門・単価・初期在庫・棚番号・発注数等の登録 | masters:write |
| /tools/[id] | 基本情報・棚別残高・在庫方針・権限付き直近履歴、通常入出庫へのリンク | inventory:read |
| /tools/[id]/edit | 基本情報・単価・在庫方針の編集 | masters:write |
| /admin/masters | 保管場所管理 | masters:write |

工具詳細の初期在庫フォームは管理者だけに表示する。設備・仕入先・購買条件の表示やフォームは作らない。

## 入力とDB整合性

- 工具・保管場所コードは前後空白を除き大文字化し、[A-Z0-9_-]{1,32}に限定する。同種のコード重複は409。登録後の変更と物理削除は提供しない。
- 名前は1〜100文字、分類は1〜64文字、単位は1〜16文字、メーカー・型番は0〜100文字。省略する旧メタデータの既定値は登録仕様に従う。
- 在庫行または取引履歴がある工具の単位変更は409。名称変更は過去の取引数量へ影響させない。
- 数量は整数、単価は非負のDecimalで小数2桁以内。0≦安全在庫≦発注点≦目標在庫を維持する。
- 工具の登録・在庫方針・正数の初期在庫・発注数によるOPEN候補・監査を一つのトランザクションで保存し、失敗時は全て戻す。
- 部門・単価の正本はtools。tools.unit_priceを優先し、NULLの旧工具だけ旧優先条件の価格を読み取り互換で利用する。仕入先情報は公開DTOへ含めない。

## 初期在庫

未登録の工具×保管場所に一度だけ登録できる。0でも残高行を作り、再登録は409。reservedは0とする。正数はRECEIVE履歴を作り、固定理由「初期在庫登録」とセッションのactor_user_idを保存する。0の場合は数量非ゼロ制約に従って取引履歴を作らない。どちらもINITIAL_STOCK_REGISTERED監査を同一トランザクションに保存する。

リクエストキーはphase3-initial:<UUID>。監査を再送照合の正本とし、同じキー・操作者・内容には元の結果を返す。異内容・異なる操作者のキー再利用は409。成功後に対象マスタが無効化されても同内容再送は可能だが、現在のセッションと権限は必ず確認する。

## APIとサービス

MastersServiceはlistTools、toolDetail、listMasters、createTool/updateTool、createMaster/updateMaster、registerInitialStockを提供する。listMasters/createMaster/updateMasterのkindはlocationsだけ。saveSupplierItemは提供しない。

| API | 内容 |
| --- | --- |
| /api/tools | GET検索、POST登録 |
| /api/tools/[id] | GET詳細、POST更新 |
| /api/tools/[id]/initial-stock | POST初期在庫 |
| /api/masters/locations | GET保管場所、POST登録 |
| /api/masters/locations/[id] | POST保管場所更新 |

旧machines/suppliersマスタと工具のsupplier-items APIは404。GETは認証・認可後にno-storeで返す。書き込みはOrigin照合・現在のセッション・権限・入力検証を経由する。匿名401、権限不足/Origin不一致403、不正入力400、未存在404、重複/状態競合409、入力過大413、不正Content-Type415、接続不能503。HTMLフォームは303遷移と日本語メッセージを用いる。

低頻度管理処理はAuthService.authorizedのusersテーブルSHARE ROW EXCLUSIVEロックを経由する。初期在庫ではstock_balancesのロックと一意制約も利用する。業務変更とbefore/afterを含む監査は同じトランザクションで保存し、パスワード・セッション・生トークン・接続文字列を含めない。

## 検証

工具検索・棚集計・正規化と重複コード・単位変更禁止・数量/閾値/単価・初期在庫0/正数・再送・競合・監査失敗の全ロールバックを専用DBで確認する。HTTPで認可・Origin・非公開単価・フォーム遷移・旧API404を確認する。既存の設備・仕入先関連行が保持されることも回帰検証する。
