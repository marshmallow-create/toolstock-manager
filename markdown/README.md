# ToolStock Manager

ログイン・マイページ・工具登録/詳細/編集・入出庫履歴/詳細・ユーザー管理・404画面は、最大幅1600pxの共通レイアウトです。見出し・余白・入力欄・カードのサイズを統一し、画面幅に応じてフォームを折り返します。各操作の権限は従来どおりです。

入出庫履歴はマイページと同じレイアウトです。表示列は右から日時・品目コード・品目名・カテゴリー・入出庫履歴・数量・操作者・在庫数・単価。数量は取引時の数量、在庫数は取引直後の値です。管理者は単価の下限・上限（両端を含む）で検索できます。既存履歴で記録のない値は「—」を表示し、単価の範囲検索には含めません。

既存環境では `npm.cmd run db:migrate` で `20261107020000_history_snapshots` を適用してください。シードの再投入は不要です。

Phase 4（入出庫・履歴）まで実装済み。既存の開発指示書を要件の基準とします。データはすべて架空、外部送信・本番デプロイはありません。

## 必要環境

Node.js 22.12以上（LTS推奨）、npm、Docker Desktop（Linux containers / Compose v2）。PowerShellでは実行ポリシー変更を避けて `npm.cmd` を使用します。

## 初回起動（PowerShell）

```powershell
Copy-Item .env.example .env
npm.cmd install --cache .npm-cache
npm.cmd run db:generate
docker compose up -d --wait
npm.cmd run db:migrate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

http://127.0.0.1:3000/ を開くと、最初にログイン画面（/login）へ移動します。ログイン後の`/api/health/db` は接続と tools テーブルを確認し、成功時200、接続・未適用DDLエラー時503を返します。詳細な接続情報は返しません。DBとWebはlocalhost限定です。

依存は package.json で完全固定しています。package-lock.json は生成済みです。以後の再現インストールには `npm.cmd ci` を使用してください。Prismaスキーマ検証・型検査・本番ビルドは成功しています。

シードは明示許可が必要です。再実行しても既存マスタ・在庫・履歴を更新しません。A001（作業者 / WORKER）とADMIN001（管理者 / ADMIN）は架空ユーザーです。初期設定の対象はこの2アカウントだけです。auth:setup-dev で個別のランダムパスワードを設定し、.local/dev-credentials.json に保存します。このファイルはGit対象外です。既存資格情報を上書きせず、コンソールや文書へパスワードを出力しません。実環境では使用しないでください。

## 検証

```powershell
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd run build
# 専用DBの作成は初回だけ
 docker compose exec db createdb -U toolstock toolstock_test
npm.cmd run test:db
# 再実行しても件数・残高が変わらないことを確認
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run db:seed
npm.cmd run db:seed
Remove-Item Env:ALLOW_LOCAL_SEED
```

DBテストは TEST_DATABASE_URL（DB名にtestを含むこと）を使い、一時スキーマへのDDL適用と負在庫・過剰引当・重複棚在庫・FK・二重リクエスト・履歴改変拒否を検証しロールバックします。既存の phase1_test スキーマがある場合は停止します。同時出庫と認証・認可の検証はnpm.cmd testに含まれます。発注ワークフローはPhase 5以降です。

ビルド後の起動は `npm.cmd start`。開発サーバーは Ctrl+C で停止、DBは `docker compose stop`。`docker compose down` でもボリュームは保持します。`down -v` はデータを消すため通常使用しません。

## ローカルバックアップ・復元

```powershell
New-Item -ItemType Directory -Force backups
# Windows PowerShellのバイナリリダイレクトを避け、コンテナ内で生成してコピー
 docker compose exec db pg_dump -U toolstock -d toolstock_dev -Fc -f /tmp/toolstock.dump
 docker compose cp db:/tmp/toolstock.dump backups/toolstock.dump
# 復元先は新しい検証専用DB
 docker compose exec db createdb -U toolstock toolstock_restore_test
 docker compose cp backups/toolstock.dump db:/tmp/restore.dump
 docker compose exec db pg_restore -U toolstock -d toolstock_restore_test --no-owner --exit-on-error /tmp/restore.dump
 docker compose exec db psql -U toolstock -d toolstock_restore_test -c 'SELECT count(*) FROM tools;'
```

復元手順は今回未実行。本番投入前に件数・残高・履歴を照合してください。

## Phase 1の検証記録（2026-11-03）

以下の日付付き記録は各実行時点の結果です。廃止済み機能を含む当時の検証内容は、現在の操作手順・権限を表しません。現在の手順は上記起動手順と下記「Phase 3/4の使い方」を参照してください。

Phase 1の主要な受入確認が完了しました。

- Docker ComposeのDB起動: 通常のPowerShellで利用者が実施、PostgreSQLへの接続成功を確認。
- `db:validate`、Client生成、`typecheck`、`build`: 成功。
- `db:migrate`: 初期マイグレーション適用成功。再実行は適用待ちなし。
- `db:seed`: 成功。架空ユーザー4件、工具4件、設備3件、棚3件、仕入先1件、在庫4件・合計80、初期入庫履歴4件。
- シード再実行: 全13テーブルの全行を比較し、既存データ・残高・履歴が不変であることを確認。
- `test:db`: 1テスト成功、失敗0。負在庫、過剰引当、棚在庫重複、参照整合性、履歴更新/削除、二重リクエストを検証。
- Webトップ: HTTP 200、タイトル確認。`/api/health/db`: HTTP 200、status=ok、tools=4。DB停止時503も確認済み。
- バックアップ復元、同時出庫、認証認可、発注処理は今回の検証対象外。後続Phaseで確認。

### 制限環境への対応

CodexからDockerエンジンへのアクセスは拒否されるため、コンテナの起動・停止は通常のPowerShellで実施してください。ユーザー別インストールのDocker CLIを現在のPowerShellだけで利用する場合:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
docker info
```

この環境ではtsxがOSユーザー情報取得（uv_os_get_passwd）で失敗したため、seedとDBテストは `scripts/run-typescript.mjs` でTypeScriptをJavaScriptへ変換して実行します。esbuildを直接依存に固定し、tsxは削除しました。生成物は `.cache/typescript/`（Git対象外）です。操作コマンドは従来どおり `npm.cmd run db:seed` / `npm.cmd run test:db` です。

## Phase 2の使い方

既存環境では次を実行します。今回の開発DBには追加マイグレーションと初期資格情報の設定を適用済みです。既にサーバーを起動している場合はCtrl+Cで停止してから再起動してください。

```powershell
npm.cmd run db:migrate
npm.cmd run db:generate
$env:ALLOW_LOCAL_SEED = 'yes'
npm.cmd run auth:setup-dev
Remove-Item Env:ALLOW_LOCAL_SEED
npm.cmd run dev
```

ログインURL: http://127.0.0.1:3000/login 。パスワードは .local/dev-credentials.json を手元のエディターで確認してください。

| 社員ID | ロール |
| --- | --- |
| A001 | 作業者（WORKER） |
| ADMIN001 | 管理者（ADMIN） |

ロールは上記の2種類です。追加マイグレーション `20261105010000_two_roles` は廃止したロールの既存ユーザーをWORKERへ移行します。社員ID・パスワード・有効状態・履歴の関連は維持し、対象ユーザーのセッションを無効化します。管理者への自動昇格は行いません。必要な昇格は管理者がユーザー管理画面で実施します。過去のマイグレーションSQLは変更せず、新規DBでも追加マイグレーションまで適用してください。

- /dashboard は全ロールがログイン後に利用可能。許可される操作を表示する。
- /admin/users は管理者専用。登録・氏名/ロール変更・無効化/再有効化・パスワード再設定を行う。ユーザー削除は行わない。
- ログアウト、無操作30分、最長8時間でセッション失効。権限/状態/パスワード変更でも既存セッションを失効させる。
- DBにはsalt付きscryptハッシュとセッショントークンのSHA-256ハッシュのみ保存。ログイン・ログアウト・ユーザー管理の成功操作を監査記録する。ログイン失敗はDBの試行制限で追跡し、5回失敗すると15分間制限する。
- POSTはAPP_ORIGINとのOrigin照合が必要。.env.example の値は http://127.0.0.1:3000 。localhostや別ポートでアクセスする場合はAPP_ORIGINも変更してサーバーを再起動する。HTTPSではCookieにSecureを付ける。
- ログインAPIはユーザー情報とCookieを返す。トークンをJSONで返さない。ユーザー一覧へpassword_hashを含めない。
- GET /api/auth/session、GET /api/health/db は未ログイン時401。GET /api/admin/users とPOST /api/admin/users[/id] は未ログイン401、権限不足403。フォーム入力エラーはメッセージ付き303遷移、JSONは400/409等を返す。
- DB接続APIは認証済みの場合のみ利用する。Phase 1時点の匿名200から変更した。

### Phase 2検証

```powershell
npm.cmd run db:validate
npm.cmd run typecheck
npm.cmd test
```

npm test は権限・移行・DB制約・認証・マスタ・在庫サービス、本番ビルドとHTTP結合テストを順に実行します。以下の15件という結果はPhase 2実装当時の記録です。TEST_DATABASE_URLはDB名にtestを含む専用DBとし、開発DBと分離する。認証テストは毎回一時スキーマへ全マイグレーションを適用し、終了時に一時スキーマを削除する。HTTPテストは空きローカルポートで実際のNext.jsサーバーを起動し、終了時に停止する。

2026-11-03: 15件成功、失敗0。型検査・Prisma validate/generate・ビルド成功。権限表、セッション失効、並行試行制限、管理者の相互降格、Cookie、401/403、Origin、JSON/APIとHTMLフォーム遷移を確認。開発DBの既存在庫・履歴・マスタ・発注は11テーブル全行の前後比較で不変。資格情報設定の再実行でも資格情報ファイルが不変。

Phase 2実装時点ではブラウザ上の見た目・タブレットでの操作確認は未実施。画面のHTMLとフォーム処理はHTTP経由で検証済み。社内ID連携、期限切れレコードの定期清掃、本番用DB権限分離・運用設定は後続で確定する。

### ファイル配置

npm/Next.jsの正本となる package.json・package-lock.json・tsconfig.json はプロジェクトルートに置く。作業中にjson/へ移動された元ファイルは保持したが、以後の編集対象はルート側とする。Markdown文書はMarkdown/とdocs/を使用する。

## Phase 3の使い方

ログイン後、マイページのログイン情報の下に工具一覧を表示します。検索とページ切り替えは /dashboard 内で利用でき、/tools は検索条件を引き継いで /dashboard へ転送します。工具番号・工具名・型番の部分一致、分類、状態で絞り込み、工具詳細で保管場所別の実在庫・引当・出庫可能数を確認できます。既存環境はnpm.cmd run devで利用でき、Phase 3の追加マイグレーションやシード再投入は不要です。

管理者は「工具を登録」から基本情報・単価・在庫方針を登録し、「保管場所管理」で棚を管理します。工具詳細で初期在庫を登録できます。作業者には単価を表示しません。設備・仕入先・購買条件の画面とAPIは廃止しました。

- コードは半角英数字・ハイフン・アンダースコア32文字以内。前後空白を取り除き大文字化して保存します。同じ種類での重複は不可、登録後変更も不可です。
- 初期在庫は工具×保管場所ごとに一度だけ。0で登録した場合も登録済みです。通常の増減は入出庫、誤操作は管理者による理由付き取消で記録します。
- 初期在庫の再送は同じリクエストキーで識別し、在庫を二重計上しません。正数の初期在庫には入庫履歴が残ります。
- 在庫がある工具の数量単位は変更できません。必要なら別の工具として登録してください。
- 安全在庫≦発注点≦目標在庫。工具単価は小数部2桁以内です。
- マスタの無効化では残高・履歴を削除しません。工具単価は直接設定した値を優先し、未設定の旧工具だけ旧優先条件の価格を利用します。

### Phase 3の検証

npm.cmd testは既存のDB・認証・HTTP検証に、マスタ/初期在庫サービスとマスタHTTP検証を加えて実行します。いずれもTEST_DATABASE_URLの専用DB内に一時スキーマを作り、終了時に削除します。既存開発アカウントの資格情報ファイルは読みません。

個別にはnpm.cmd run test:masters、npm.cmd run test:masters-httpで実行できます。HTTPテストはnpm.cmd run build後に実行してください。npm.cmd run typecheckはPrismaとNext.jsの型を生成してから検査するため、next-env.d.tsをコミットする必要はありません。

2026-11-03: npm testは37件成功・失敗0（DB制約1、既存認証10、マスタサービス15、既存HTTP4、マスタHTTP7）。本番ビルド・型検査・Prisma validateも成功しました。PC幅1440px・タブレット幅768pxのChromiumで工具一覧・詳細・登録・マスタ管理の表示を確認し、ブラウザのフォームから工具登録・初期在庫登録・購買条件更新がDBへ保存されることを確認しました。タブレット実機・スクリーンリーダーでの検証は未実施です。

## Phase 4の使い方

ログイン後、マイページの工具一覧から工具を選び、工具詳細の「入庫」「出庫」を開いて操作します。両ロールが利用できます。履歴はメニューの「入出庫履歴」からも開けます。旧 /inventory/issue・/inventory/receive は404になります。

- 工具詳細の「出庫」: 工具一覧で選んだ工具の出庫欄を開き、数量を確定します。数量は初期値1で＋/－に対応し、単位と出庫後の見込みを表示します。
- 工具詳細の「入庫」: 同じ工具詳細で入庫欄を開き、数量を確定します。理由の入力は不要です。
- /history: 日付（日本時間）、工具、操作者、種別で履歴を検索します。作業者は本人の入出庫とその管理者による取消だけ、管理者は全員の入出庫を閲覧できます。
- 履歴詳細の「理由を付けて取り消す（逆取引）」: 管理者が全量を逆取引として戻します。元の履歴は残ります。正しい数量・棚・工具は取消後に新しい操作で登録してください。消費済みの入庫の取消等で在庫条件を破る場合は拒否します。

成功すると確定した履歴へ移動します。「確定時の記録」の残高はその操作時点の値です。最新の残高は工具詳細で確認してください。同じリクエストキーの再送で在庫や履歴が重複しない仕組みがありますが、フォームを開き直して別のキーで確定すると新しい操作になります。

棚卸・設備・仕入先・購買条件の登録/更新と画面は提供しません。旧APIと /inventory/adjust は404になります。過去の関連データ・履歴と成功済み要求の同内容再送は保持します。新しい通常取引に設備は指定できません。

### Phase 4の検証

npm.cmd testは全サービス・移行・HTTPの回帰検証を実行します。個別にはnpm.cmd run test:inventoryとnpm.cmd run test:inventory-http。HTTPテストはnpm.cmd run buildの後に実行してください。型検査はnpm.cmd run typecheck、DBスキーマの検証はnpm.cmd run db:validateです。DBテストはTEST_DATABASE_URLの一時スキーマのみを使います。

2026-11-04: npm testは全64件成功・失敗0（既存37件＋在庫サービス19件＋在庫HTTP8件）。型検査・本番ビルド・Prisma validateも成功。ChromiumのPC幅1440px/タブレット幅768pxで出庫・入庫・棚卸・履歴一覧・詳細の10画面を確認し、横あふれなし。実ブラウザで数量＋/−、棚の自動選択、設備必須、出庫・同キー再送・逆取引・手動入庫・棚卸・本人履歴を確認した。検証は専用DBの一時スキーマで実行した。タブレット実機・スクリーンリーダー・実工場での棚卸運用は未検証です。

### 2ロール構成の検証（2026-11-05）

全75件のテスト（権限3・移行3・DB制約1・認証11・マスタ17・在庫19・認証HTTP5・マスタHTTP8・在庫HTTP8）、型検査、本番ビルド、Prisma validateが成功。ブラウザでロール選択が作業者/管理者だけであることと、両ロールの入出庫・履歴を確認した。初期シードは2アカウントのみを作成し、再実行しても在庫を変更しない。ローカルDBへ追加移行を適用し、対象2名をWORKERへ移行、旧セッション失効、監査2件を確認。業務11テーブルとユーザーのID・氏名・パスワード・有効状態等のハッシュは移行前後で一致した。

### 入出庫の簡素化の検証（2026-11-07）

`npm.cmd test` は全78件成功・失敗0（権限3・ロール移行3・DB制約1・認証11・マスタ16・在庫21・認証HTTP5・マスタHTTP9・在庫HTTP9）。型検査、本番ビルド、Prisma validateも成功しました。

専用DBの一時スキーマで、作業者の設備指定なし出庫・理由なし入庫、管理者の取消、本人の入出庫と取消の3件の履歴を実ブラウザで確認しました。廃止画面・APIの404と、PC幅1440px/タブレット幅768pxの8画面で横あふれがないことも確認しました。シードは設備・仕入先・購買条件を作成せず、工具へ直接単価1250.00を設定し、再実行しても在庫を変更しません。

ローカル開発DBへ追加移行 `20261107000000_simple_inventory` を適用済みです。移行前後で13テーブルの件数と全行のハッシュが一致し、既存データ・履歴が変わっていないことを確認しました。タブレット実機・スクリーンリーダーでの検証は未実施です。

工具登録は、管理者がマイページ右上の「メニュー」→「工具を登録」から開きます。
