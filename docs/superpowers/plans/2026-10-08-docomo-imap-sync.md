# docomo IMAP同期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存EAGLE帯広店PWAに安全なメール自動取得を統合し、VMG履歴と最新報告を重複なく分析できるようにする。

**Architecture:** Expressで既存PWAとAPIを同一オリジンに配信する。共通解析器・取込サービスをVMGとIMAPで使用し、SQLiteリポジトリ層へトランザクション保存する。ブラウザは従来のIndexedDB形式を維持する。

**Tech Stack:** Node.js 24、Express、imapflow、mailparser、node-cron、better-sqlite3、node:test、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-08-docomo-imap-sync-design.md`

## Global Constraints

- このリポジトリの`feature/docomo-imap-sync`のみ変更する。mainを変更しない。
- 現クラウド環境は隔離済み。追加worktreeは作らない。
- 既存PWAのUI・VMG・IndexedDB・CSV・JSONバックアップ／復元を維持する。
- IMAPは`imap.spmode.ne.jp:993`、TLS検証を維持する。
- 認証情報はサーバー側.envのみ。Git・ブラウザ・レスポンス・ログに出さない。
- cronはAsia/Tokyoの11:10、11:30、15:10、15:30、19:10、19:30。
- オフライン時の表示は「最終取得データを表示中」。APIはキャッシュしない。
- API認証有効時はHttpOnlyセッションを使用し、ブラウザの永続ストレージに認証情報を保存しない。

## Review Focus

- UIDVALIDITYが変わっても取りこぼしや別メールとのUID衝突が起きない（Task 3）。
- 同期途中の解析失敗を再試行でき、成功メールは重複登録されない（Task 3）。
- Message-IDがないVMGとIMAPの同本文を重複させない（Task 1、2）。
- 前月に同日がない日付は別日と比較せず、欠落値はゼロにしない（Task 5）。
- ネットワーク復帰時のVMG再送とAPI更新で端末内履歴が消えない（Task 5）。

---

### Task 1: 既存PWAの保存と共通メール解析

**Files:** `public/`（提供ZIPの7ファイル）、`package.json`、`package-lock.json`、`.gitignore`、`src/parser.js`、`src/vmg.js`、`test/parser.test.js`、`test/fixtures/report.txt`。

**Interfaces:** `parseReport(text) -> {summaries, records, specials}`。各行は既存の`date,time,store,storeTotal,customers,util,share`を使用し、貸玉は`rate,machines,male,female`、注目群は`group,machines`を加える。`decodeVmg(buffer) -> EmailInput[]`。`EmailInput = {messageId,subject,sender,receivedAt,text,imapIdentity?}`。

- [ ] 提供ZIPをpublicに原形で取り込み、秘密・DB・生成物のignoreを追加する。
- [ ] 解析テストを書く：11/15/19時、全角括弧・数字・余分な空行、新種別`7.5円S`、複数店舗、総合計、注目群、欠落シェアはnull、対象外本文は空配列。VMGのbase64・Shift_JIS・Message-IDなしを含める。
- [ ] `node --test test/parser.test.js`で実装なしの失敗を確認する。
- [ ] 正規化と動的貸玉認識を実装する。総合計がない場合、判明した貸玉の客数合計と総台数から算出し、算出由来を付ける。客数シェアは推測しない。
- [ ] 同コマンドが全テスト成功することを確認しコミットする。

### Task 2: SQLite永続化と共通取込

**Files:** `src/db.js`、`src/ingest.js`、`test/db.test.js`。

**Interfaces:** `openRepository(path) -> Repository`。`Repository.saveEmail(email, report) -> {duplicate, emailId}`、`query(kind,filters) -> rows`、`getStatus()`、`getCursor(scope)`、`setCursor(scope,cursor)`、`close()`。`ingestEmail(repository,email) -> {outcome:'new'|'duplicate'|'ignored'}`。

- [ ] 一時DBで同メール2回、VMGとIMAPの重複、Message-ID欠落、異なるUIDVALIDITY、再起動保持、保存失敗時ロールバックのテストを書く。
- [ ] `node --test test/db.test.js`で失敗を確認する。
- [ ] emails、store_summary、rate_summary、special_group、sync_stateを作成する。UIDはスコープとUIDVALIDITYを含む一意キー、Message-IDと正規化本文ハッシュも重複キーにする。外部キー・検索インデックス・バインドSQLを使用する。
- [ ] `ingestEmail`で対象判定、共通解析、保存を行う。未解析メールを成功扱いにしない。
- [ ] 同コマンドで全テスト成功を確認しコミットする。

### Task 3: IMAP・状態・定時同期

**Files:** `src/config.js`、`src/imap.js`、`src/sync.js`、`src/scheduler.js`、`.env.example`、`test/sync.test.js`。

**Interfaces:** `loadConfig(env) -> Config`、`createImapSource(config) -> source`、`source.fetch({since,cursor}) -> {messages,uidValidity}`、`createSyncService(repository,source) -> {sync({since}?),status()}`、`startScheduler(syncService) -> stop()`。sourceはメールとUID情報を返し、サービスが成功した範囲のカーソルを更新する。

- [ ] 模擬sourceで接続成功／失敗、1通／複数／未着／対象外、再同期、VMG重複、UIDVALIDITY変更、同時同期、途中失敗後再試行をテストする。エラーにパスワードが含まれても公開状態に残さない。
- [ ] `node --test test/sync.test.js`で失敗を確認する。
- [ ] imapflowのメールボックスロックとUID検索、mailparserによるMIME解析、TLS、タイムアウト、必ずlogoutする処理を実装する。初回sinceは日本の暦日として扱う。
- [ ] 一度に1同期のみ実行し、成功・失敗・未着を区別する。解析失敗位置を越えてカーソルを進めない。cron式`10,30 11,15,19 * * *`とtimezone`Asia/Tokyo`を設定する。
- [ ] 同コマンドで全テスト成功を確認する。設定が安全に用意された場合だけ実docomoへ読み取り接続し、未設定なら未実施として記録する。コミットする。

### Task 4: APIと認証境界

**Files:** `src/app.js`、`src/server.js`、`src/auth.js`、`test/api.test.js`。

**Interfaces:** `createApp({repository,syncService,config}) -> ExpressApp`。GET status/summary/rates/specials、POST sync（任意since）、POST import/vmg（サイズ制限付き）、GET data（既存PWA形式とmailKeys）。認証設定時はPOST sessionでログインしHttpOnly Cookieを発行する。

- [ ] HTTPテストを書く：各APIの返却形式、日付・時刻・店舗・貸玉フィルタ、不正日付・過大ファイル・不正VMG、同期競合、秘密なし、認証必須時の401、別オリジンの更新リクエスト拒否。
- [ ] `node --test test/api.test.js`で失敗を確認する。
- [ ] API、静的配信、入力検証、サイズ上限、同一オリジンの更新制限、任意の認証を実装する。本番では安全な認証設定を要求し、CookieをSecureとする。
- [ ] 起動・終了でDBとcronを管理する。DBファイルはpublic外に置く。
- [ ] 同コマンドで全テスト成功を確認しコミットする。

### Task 5: 既存PWAとの統合と分析拡張

**Files:** `public/index.html`、`public/api-client.js`、`public/analysis.js`、`public/service-worker.js`、`test/analysis.test.js`、`test/pwa.spec.js`、`playwright.config.js`。

**Interfaces:** `comparisonDate(date,period) -> date|null`（periodは1/7/28/month）、`compareRows(current,previous) -> {customers,util,share}`。APIデータを既存Sへレポートキーでマージし、端末内独自履歴は保持する。

- [ ] 比較日付テストで東京時間の日付ずれ、閏年、31日の前月欠落、欠落比較値を検証する。ブラウザテストで起動時例外なし、総合一覧・CSV、VMG取込・バックアップ復元、同期表示を検証する。
- [ ] `node --test test/analysis.test.js`と`npx playwright test`で未実装の失敗を確認する。
- [ ] summary/summaries参照不一致を修正する。既存画面を保ち、同期ボタン・状態・必要時のログイン・前日／前月比較、貸玉の客数・稼働率・シェア差を追加する。
- [ ] オンライン起動時に既に取得済みのAPIデータを表示する。IndexedDBの既存キーを保持し、保留VMGの復帰後アップロードは成功後のみ削除する。ローカルクリアとサーバー削除は区別する。
- [ ] Service Workerを更新しAPIを除外、旧画面キャッシュを更新する。ブラウザテストで390px縦画面、オフライン再起動、最後のデータ表示、復帰後同期、履歴保持を検証する。
- [ ] 両コマンドで全テスト成功を確認しコミットする。

### Task 6: 起動検証と引き渡し

**Files:** `README.md`、`.env.example`、`docs/testing.md`。

**Interfaces:** `npm start`で配信とcronを開始、`npm test`でユニット・API、`npm run test:e2e`でブラウザ検証。

- [ ] READMEに構成・.env設定・docomo専用ID設定・起動・履歴取込・同期・cron・HTTPS・Androidインストール・JSON移行・エラー診断を記載する。
- [ ] `npm ci`、`npm test`、`npm run test:e2e`を実行し結果を記録する。実docomo接続の未実施を模擬テスト成功と区別する。
- [ ] `npm start`で起動しGET statusと静的画面を確認する。停止・再起動後に取込済みDBを読み取れることを確認する。
- [ ] 秘密・DB・node_modulesが追跡されていないことと`git diff --check`を確認する。必要なクラウドinstall_script／start_skillを保存する。
- [ ] 最終変更一覧・テスト・未解決事項を報告する。GitHub pushは認証済みHTTPS経路でこの専用リポジトリの作業ブランチのみへ行い、mainへマージしない。
