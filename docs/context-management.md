# Context Management

会話は消える。ファイルは残る。EduWatch JP で意思決定や進捗を保全するための運用方針。

姉妹サイト EduEvidence JP の `docs/context-management.md` と同じ思想を採用。本サイトでは edu-watch 固有の事情(日次自動収集の cron 監視、ソース追加/除外の意思決定、週次ダイジェスト編集)に合わせて運用する。

## 基本原則 — File is the memory

Claude Code とのセッションは context window の上限に達すると圧縮される。圧縮時に失われやすいのは「議論の過程」「却下した選択肢の理由」「試行錯誤のログ」。これらをファイルに書き出しておけば、圧縮を跨いで保全できる。

| レイヤ | 役割 | 配置 |
|---|---|---|
| **`.claude/state/active.md`** | 現在のセッションのチェックポイント。マイルストーンごとに更新 | `.gitignore` で git 追跡しない |
| **`docs/decisions/<連番>-*.md`**(ADR) | 主要意思決定の不変記録 | git 追跡、Public |
| **`docs/sessions/<日付>.md`**(任意) | 1 セッションの議事録要約 | git 追跡しない |
| **メモリ**(`~/.claude/projects/.../memory/`) | 運営者の個人的な嗜好・私的方針 | Private、リポジトリ外 |
| **`CLAUDE.md` / `docs/PRD.md` / `docs/sprint-2-design.md`** | プロジェクトの恒久的な規約・設計 | git 追跡、Public |

## レイヤ間の振り分け指針

- **「決まったこと」** → ADR(`docs/decisions/`)
- **「いま作業中の具体内容」** → `.claude/state/active.md`(逐次更新)
- **「変わらない規約・設計」** → `CLAUDE.md` / `PRD.md` / `sprint-2-design.md`
- **「運営者の個人的な嗜好」** → メモリ(リポジトリ外)
- **「公開しない議事録」** → `.gitignore` 配下(必要なら `docs/sessions/`)

迷ったときの判断:**「他のメンテナーが半年後に読んで意味があるか」=Yes なら ADR、No なら state / メモリ**。

## active.md の運用

`.claude/state/active.md` は **生きたチェックポイント**。以下のタイミングで更新する:

- 主要な意思決定が確定した時
- PR を作成した / マージした時
- 別ブランチに切り替える時
- 同じ問題で 2 回以上試行錯誤した時(失敗ログとして)
- ソースを追加 / 除外した時(edu-watch 固有)
- 日次 cron が連続失敗した時(edu-watch 固有)
- セッション終了時

## ADR の運用

`docs/decisions/<連番>-<短いスラッグ>.md` の形式。詳細なテンプレートと運用方針は [`./decisions/README.md`](./decisions/README.md) を参照。

ADR は **不変** が原則。決定が覆ったら新規 ADR を起こし、旧 ADR の「状態」を `撤回(####で上書き)` にする。

姉妹サイト EduEvidence JP と共通の運営方針(植物モチーフブランド体系、Node 24 LTS、公開氏名、本体非営利 + SaaS 分離)は edu-evidence 側の ADR(`0001` `0002` `0004` `0005`)に集約しており、本リポジトリには edu-watch 固有の判断のみを置く。

## 圧縮(compaction)対策

### 自発的に圧縮するタイミング

- context 使用率が 60〜70% に達した時
- 関連の薄いタスクに切り替える時(`/clear` を使う)
- 同じ修正を 2 回試して失敗した直後
- ファイルへの書き出し / コミット / PR 作成の直後

### 圧縮直前の準備

`.claude/hooks/pre-compact.sh` が以下を会話に dump する:

- `.claude/state/active.md` の内容
- git の uncommitted / staged / untracked ファイル一覧
- 直近 5 コミットのログ

### 圧縮直後の復元

`.claude/hooks/post-compact.sh` が「active.md を読み直せ」というリマインダーを出す。

## edu-watch 固有の運用ポイント

### 日次 cron の監視

`.github/workflows/fetch-news.yml`(Sprint 2 Batch 3 で実装予定)が日次で動く。失敗が連続した場合は active.md に記録し、原因を ADR にすべきか判断する。

### ソース追加 / 除外の意思決定

ソースを 1 つ追加 / 除外するたびに、その判断は ADR レベルに昇格しうる。複数のソースをまとめた一括判断(例: ADR 0004 で OECD / EEF を同時に除外)も妥当。

### 週次ダイジェスト編集の作業履歴

週次ダイジェストの編集判断(取り上げる / 落とす)は本リポジトリには残さない。編集者の私的メモ(`docs/sessions/` または運営者のメモリ)に留める。

## サブエージェント運用との連携

- **メインで読む**: 1〜2 ファイル対象、すぐ判断に使う
- **サブエージェントに投げる**: 複数ファイル横断、5k トークン以上のファイル走査、調査フェーズ

サブエージェント結果が長い場合は、要点のみを active.md に転記し、生の出力は破棄する。

## セッション境界での運用

### セッション開始時

1. `.claude/state/active.md` を読む(最優先)
2. 直近の git log / git status を確認
3. 進行中の PR を `gh pr list` で確認
4. 必要なら関連 ADR(`docs/decisions/`)に目を通す
5. cron 失敗ログがあれば確認(Sprint 2 Batch 3 以降)

### セッション終了時

- active.md に「次回の起点」を 1〜2 行書く
- 主要な意思決定があれば ADR を起こす

## 参考

- 姉妹サイト EduEvidence JP の [`docs/context-management.md`](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/context-management.md)(同思想)
- 元になったパターン: [Donchitos/Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) の `.claude/docs/context-management.md` の核思想を本リポジトリ向けに調整
