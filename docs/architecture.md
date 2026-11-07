# 構成

描画する全ページはWorkspaceShellを利用する。従来の個別Shell、ログインの狭い幅、ユーザー管理専用の幅は廃止し、フォーム・ボタン・カードのサイズを共通定数でそろえる。ログインは利用者情報を渡さず、404は有効なセッションがある場合だけ本人情報を表示する。転送専用のルートとAPIの応答形式は維持する。

DBクライアントのグローバルキャッシュは生成済みPrismaClientのコンストラクターと接続URLが一致する場合だけ再利用する。開発中の再生成・ホットリロードで古いスキーマのクライアントが残った場合は作り直し、旧プールを切断する。

履歴とマイページは `WorkspaceShell` でヘッダー、ログイン情報、権限別メニュー、最大幅1600pxと余白を共有する。スクロールバーの有無で幅が変わらないよう余白を確保する。履歴表は右から指定順に並べ、狭い画面では日時側から横スクロールできる。

履歴APIの `unit_price_min` / `unit_price_max` は保存された単価へ包括境界のDecimal条件を適用し、件数取得・50件ページングより前に絞り込む。`movement=RECEIVE|ISSUE` は数量の符号を使い、取消も実際の増減方向で検索する。従来のtypeフィルターもAPI互換として維持する。作業者の単価値と範囲条件はサーバーで制御する。

Next.js App Routerのサーバー処理からPrisma Clientとpgアダプターを通してローカルPostgreSQLへ接続する。DBクライアントは遅延生成し開発中の再ロードでプールを増やさない。接続タイムアウト3秒。ブラウザへ資格情報を送らない。

トップの / は /login へ転送する。認証後は /dashboard（マイページ）を利用する。GET /api/health/dbは認証済みユーザーだけが利用し、SELECT 1に加えて工具テーブルを読んで未適用DDLを検出する。ローカルに限定して起動する。

Next.js 16 / React 19 / Tailwind 4 / Prisma 7。Prisma 7では接続URLとseedをprisma.config.tsへ分離し、生成先をsrc/generated/prismaとしpgアダプターを使用する。依存は完全固定、npm経由の実互換性とlockfile生成は環境制限解除後に確認する。

公式参照（2026-11-03確認）:
- https://nextjs.org/docs/app/getting-started/installation
- https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7
- https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding

業務書き込みは共通の認証・認可・Origin照合を経由する。本番運用時のアプリDBロールとマイグレーション管理者の分離・必要最小権限設定は後続の運用整備で行う。Composeの所有者資格情報は開発専用で、本番用ではない。

## Phase 2

現在の認可は作業者（WORKER）と管理者（ADMIN）の2ロールに統一する。作業者は在庫参照・入出庫・本人の入出庫とその管理者による取消の履歴を利用できる。管理者は全管理操作・全履歴・単価情報へアクセスできる。追加マイグレーションで廃止したロールをWORKERへ移行し、対象セッションを失効させる。既存ID・パスワード・履歴は維持する。

認証は外部サービスを使わず、src/lib/auth/crypto.ts（暗号処理）、permissions.ts（仕様の権限表）、service.ts（DBセッション・管理トランザクション）、server.ts（Next.jsのCookie/Origin/ページ・API応答）に分離。ブラウザへ渡すユーザーDTOはid/社員ID/氏名/ロール/activeのみ。各ページ・ルートで認証・認可する。Cookieの存在だけで許可しない。マイページは工具一覧と、権限に応じた履歴・管理操作のメニューを表示する。

## Phase 3

画面は /tools、/tools/new、/tools/[id]、/tools/[id]/edit、/admin/masters。既存と同じServer Components・HTMLフォーム・Route Handlersを使い、クライアント状態管理や依存パッケージは追加しない。

src/lib/masters/ は validation.ts（型・長さ・数値・UUID・業務コード）、read.ts（検索・棚集計・権限別DTO）、write.ts（工具・保管場所・在庫方針と監査）、initial-stock.ts（初期在庫・再送・競合）、service.ts（呼び出し入口）、server.ts（ページ/API用アダプター）に分離する。認可はAuthServiceに統一し、Originとフォーム/JSON応答は既存のmutateを利用する。

AuthService.authorizedは usersテーブルのSHARE ROW EXCLUSIVEロック→セッション検証/更新→権限確認→業務処理の順で実行する。既存ユーザー管理も同じ入口を使う。初期在庫は追加でstock_balancesをロックし、キー照合から残高・履歴・監査まで一体で処理する。これは低頻度の管理処理向けであり、Phase 4の高頻度出庫は別途ロック範囲を設計する。

工具単価は管理者向けDTOだけへ含める。tools.unit_priceを優先し、NULLの旧工具だけ旧優先条件の価格を読み取り互換で利用する。仕入先情報はどの公開DTOにも含めず、設備・仕入先・購買条件の編集サービス/APIは提供しない。GETはno-store。単価はDecimalから小数2桁の文字列へ変換する。更新で許可した業務項目だけをDBへ渡し、操作者や残高の任意指定は採用しない。

## Phase 4

src/lib/inventory/ は types.ts（要求/履歴/確定結果の型）、validation.ts（数量・UUID・理由・日本時間の日付）、write.ts（再送・競合・残高/履歴/監査）、read.ts（権限付き履歴検索・詳細・候補）、service.ts、server.tsに分離する。ページとAPIは同じサービスを使用する。

AuthService.inventoryAuthorizedは usersテーブルSHARE→sessions検証/更新→リクエストキーのトランザクションアドバイザリロック→工具行FOR UPDATE→棚別残高更新の順序を守る。Phase 4同士はusersの共有ロックを共存でき、Phase 3の管理/初期在庫書き込みとは競合させる。同一工具の棚操作は順序付け、別工具は別セッションから並行処理できる。lock_timeoutは3秒、トランザクションの最大時間は10秒。タイムアウト時は変更を戻し409の再試行案内にする。

/tools/[id]の入庫・出庫欄を両ロールに提供する。棚番はtools.shelf_codeを工具登録・編集から管理する。新しい工具の入出庫はその工具の内部在庫記録を自動選択し、棚番は表示のみとする。既存の複数場所にまたがる在庫・履歴は参照先を維持する。小さなクライアントフォームで数量＋/−・変更後見込みを更新する。通常取引の理由・設備入力は設けず、確定は通常のHTML POSTとする。操作キーを端末へ永続保存しない。棚卸・設備・仕入先・保管場所の管理画面と管理APIは廃止する。取消はinventory:reverseで管理者だけに許可する。/historyと/history/[id]で検索・詳細・逆取引を扱う。

既存mutateは結果に応じたredirectToと入力に応じたerrorPathへ対応し、303の成功先を確定履歴にする。エラーURLはURLSearchParamsで構築して工具選択を保持する。既存の文字列URL・Cookie設定・Origin検証・JSONの応答を維持する。

レビューで重大・重要な指摘なし。直近5件の表示では現在50件上限の履歴一覧APIを共用しており、専用の5件取得への軽量化は後続の改善候補とする。履歴の権限条件は共通化済み。

マイページはログイン情報の下に共通のToolsListを表示し、検索・ページ切り替えを/dashboardで維持する。権限一覧は表示しない。利用できる機能はログアウトの左のメニューボタンで開き、再クリック・外側クリック・Escで閉じる。サーバーで権限を確認したリンクのみクライアントへ渡す。

独立した/toolsの一覧画面は廃止し、旧URLは検索条件を引き継いで/dashboardへ転送する。工具登録後の戻り先も/dashboardに統一する。
