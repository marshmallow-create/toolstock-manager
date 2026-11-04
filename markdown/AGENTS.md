# 開発ルール

- `ToolStock_Manager_Codex_開発指示.md` を要件の基準にする。現在は利用者の承認によりPhase 4（手動入出庫・履歴）まで。発注候補・注文はPhase 5。
- 作業前に既存ファイル・Git状態を確認する。既存変更を上書きしない。
- 実データ、本番DB、外部デプロイ、メール送信、実発注を禁止する。
- `.env`・資格情報・バックアップをコミットしない。シードは架空情報のみ。
- 認証・認可は src/lib/auth/ を共通利用する。全書き込みにサーバー側認可とOrigin照合を適用する。入出庫処理は src/lib/inventory/ を利用する。
- 数量は整数、金額はDecimal、時刻はUTC。画面ではAsia/Tokyoに変換する。
- SQLのCHECK・部分一意インデックス・履歴保護トリガーを維持する。Prismaスキーマだけで再作成しない。
- 検証は README の手順に従い、未実行を成功と報告しない。
- 設計判断は docs/decisions.md に記録し、変更内容と検証結果を日本語で報告する。

- .local/dev-credentials.json は秘密情報。読み出した値をログ・報告・文書へ転記しない。
- npm設定の正本はルート。json/の保存済みコピーで上書きしない。
- 検証は npm.cmd test と npm.cmd run typecheck。HTTPテストはテスト専用スキーマを使用する。
