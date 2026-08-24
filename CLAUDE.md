# EduWatch JP

学校教員・教育関係者向けに、教育ニュースを一次情報から追う姉妹サイト(news.edu-evidence.org)。Astro 7 + React 19 + Tailwind 4 + TypeScript。

対象読者は ADR 0018 で「学校教員・教育関係者」に統一済み。保護者向けの私的関心(中学受験・習い事ランキング・幼児教育のおすすめ等)は対象外、保護者向け一次情報でも教員視点で関連するもの(家庭との連携・情報モラル指導・経済格差と学習機会など)は採用する。

- **サイト名・ブランド名**: EduWatch JP
- **リポジトリ / 技術名**: edu-watch

## ブランド

- **モチーフ**: 双葉(cotyledon、**左右非対称**)。右葉が先行して広がり、左葉がやや遅れて開く構図で「成長の瞬間・動き」を表現する。姉妹サイト EduEvidence JP の「成熟した葉(左右対称)」と対になり、ストック型 vs フロー型の性格を視覚的に区別
- **アクセント色**: ディープネイビー `#1e4a6e`(`--color-accent`)
- **wordmark**: `EduWatch <accent>JP</accent>`(末尾の `JP` のみアクセント色。edu-evidence と統一パターン)
- **ロゴ実装**: `src/components/Logo.astro` が inline SVG + `currentColor` 継承。色を変えたい時は呼び出し側の `color:` / Tailwind の `text-` クラスを変えるだけで済み、SVG を直接編集する必要なし

## 環境

Node.js は `.tool-versions` で固定(`nodejs 24.19.0`)。[mise](https://mise.jdx.dev/) 前提。

```bash
mise install               # Node 24 を導入
npm ci                     # 依存復元
npm run dev                # 開発サーバー(localhost:4323。ファミリー各リポで固定・4321 は未設定プロジェクト用に空けている)
npm run build              # 本番ビルド
npm run check              # Astro 型チェック
npm run vrt                # ビジュアルリグレッションテスト(現 dist を撮影・比較。権威ある比較は CI、後述)
npm run test:workflows     # link-check.yml の通知分岐の回帰テスト(下限つき・check:all に含む)
npm run test:hooks         # .claude/hooks/ の回帰テスト(下限つき)
```

`package.json` の `engines.node` は `>=24.0.0`。

### `test:workflows` — link-check の通知分岐

`link-check.yml` に埋め込まれた「検出をどう届けるか」の判定を固定する。**壊れても静かに壊れる** —
lychee は走り、レポートもアーティファクトに残り、job も緑のまま**通知だけ**が消える。姉妹リポ
okinawa-in-data では open な link-check Issue があると後続の検出を捨てており、2026-08-17 に
見つかった 404 が 2 日間どこにも出なかった(okinawa-in-data#107 / #110。このリポも同じコードを
共有していた)。

テストはワークフローから `run:` ブロックを取り出して bash で走らせ、`gh` をスタブして渡された
引数を全部記録する。**写しを置かないので、ワークフロー側を変えるとテスト対象も変わる** —
数値や条件をテストに書き写さないこと(上限バイト数とレポートのファイル名はワークフローから
読み取っている)。シェルからは見えない YAML の配線も併せて固定している:

- 通知ステップに `continue-on-error` が**無い**こと(付くと `gh` の失敗が job に伝わらない)
- `Run lychee` に `id: lychee` が**ある**こと(消えると `exit_code` が空文字になり毎週 Issue が立つ)
- `Upload report` が job を落とさないこと(落ちると通知ステップの暗黙の `success()` が偽になる)
- `output:` とシェルが読むファイル名が一致していること

通知は 3 分岐。タイトルが実態と食い違わないようにしてある:

| 状況 | タイトル |
| --- | --- |
| 検出あり | `Link check found problems` |
| レポートを出せず終了 | `Link check could not produce a report` |
| 1 本も見なかった | `Link check found no links to check` |

3 つ目は `lychee-action` の `failIfEmpty`(既定 true)の経路。**lychee の終了コードを 0 のまま残して
action だけが exit 1 する**ので、`exit_code` だけを見ていると通知が skip され、`continue-on-error`
で job も緑になる＝週次チェックが恒久的に no-op になる。`steps.lychee.outcome` は
`continue-on-error` 適用**前**の結果なので、そこで拾っている。

`test:workflows` / `test:hooks` は `assert-test-files.mjs` / `assert-test-results.mjs` を通している。
`node --test` は「glob が 0 件」「中身が空」「全件 skip」のどれでも exit 0 で終わるので、守って
いるつもりのガードが no-op に落ちても気づけないため。

**下限の決め方は口ごとに違う。** `test:workflows` は実測ちょうど(余裕ゼロ)なので、
**テストを足したら下限も上げること**。`test:hooks` の下限は実数追随ではなく
「1 ファイルを空にしても割る」境界値なので、実測と離れていてよい。

## プロジェクト構造

- `src/content/digests/` — 週次ダイジェスト(Markdown コレクション、本サイトの主コンテンツ)
- `src/pages/` — index(トップ) / digest(一覧・詳細) / archive / categories / sources / search / about / changelog / 404 / og / rss.xml.ts / design-tokens.json.ts
- `src/layouts/Layout.astro` — 共通レイアウト(edu-evidence と統一のデザイントークン)
- `src/styles/global.css` — デザインシステム(edu-evidence から持ち込み、将来共通化候補)
- `public/_headers` — セキュリティヘッダー
- `docs/PRD.md` — v1.0 承認済みのプロダクト要件

## 姉妹サイトとの関係

- **edu-evidence.org**(本家): 戦略 74 本・コラム 31 本のストック型エビデンスポータル
- **news.edu-evidence.org**(本サイト): 日次の教育ニュース + 週次ダイジェスト(フロー型)

Layout / styles / glossary / OG 画像ユーティリティは edu-evidence からコピー持ち込み。半年運用後に共通化(npm package 化など)を検討する。

## 現状

Sprint 1〜4(基盤構築・RSS 自動収集パイプライン・フロント実装・週次ダイジェスト)は完了し、現在は週次ダイジェストの継続運用フェーズ。直近の作業状態は `.claude/state/active.md`、要件の経緯は `docs/PRD.md` を参照。

## 編集ポリシー(PRD §6 抜粋)

- 一次情報リンクを冒頭に必須配置
- タイトル改変なし(引用は原文のまま)
- 日次記事に編集者の意見は加えない
- 週次ダイジェストに限り論点整理を付与

## ビジュアルリグレッションテスト(VRT)

共有レイアウト・コンポーネント・`global.css` の改修による視覚回帰を、目視に頼らず差分画像で検出する仕組み(ADR 0060、edu-evidence ADR 0024 のミラー)。機能テスト(`e2e/`)とは別系統で併走する:

- **設定**: `playwright.vrt.config.ts`(`testDir: vrt/`、desktop 1280 / mobile 390 の 2 projects、`maxDiffPixelRatio: 0.001`、`retries: 0`、アニメーション無効、port 4174)
- **閾値は実測で決めている**。同一ビルド同士の撮り比べは差分 0(閾値 0 で 24 件全通過 × 2 回)。
  一方 `h2` の `letter-spacing` を 0.06em 変える実験では、旧閾値 0.01 だと 24 件中 3 件しか
  落ちなかった(0.001 では 8 件)。**全画面撮影に対して 1% は緩すぎる**
- **リトライは入れない**。差分が実測 0 なら、リトライは間欠的な問題を握り潰すだけになる
- **対象**: `vrt/pages.spec.ts` がテンプレート代表 12 URL(トップ / ダイジェスト一覧・詳細 / アーカイブ一覧・詳細 / カテゴリ一覧・詳細 / ソース一覧・詳細 / about / 検索 / 404)をフルページ撮影。テンプレートを追加したら代表 URL を 1 行追記する。**`/changelog` は入れない** — PR ごとに先頭へ 1 件増えるので、内容の追加だけで必ず差分が出て本当の崩れが埋もれる(理由は同ファイル冒頭。`.github/workflows/vrt.yml` の `paths` でも `!src/pages/changelog.astro` で除外している)
- **ゲート**: `.github/workflows/vrt.yml` が `pull_request` の `paths` で描画に効くパスに限定起動する。記事データ・ダイジェストだけの PR では走らない(`workflow_dispatch` で手動実行可)。**列挙の正典は同ファイルで、ここには写さない** — 写すと片方だけが古くなる
- **比較方式(案A)**: CI 内で main と PR を両方ビルドし、同一 Linux 環境で撮影・比較する。ベースライン PNG はコミットしない(`vrt/__screenshots__/` は gitignore)。システムフォント描画の macOS↔Linux 差を回避するため
- **ローカル**: `npm run vrt` で現在の `dist` を撮影・比較できる。権威ある 2 ビルド差分は CI 側
- **required check 非対象**: 視覚変更 PR でしか起動しないため required には含めない。マージ可否は編集者判断

## ホスティング

Cloudflare Workers の静的アセット配信(Workers Builds が GitHub main を監視して自動デプロイ)。
設定は `wrangler.jsonc`。2026-08-05 に Cloudflare Pages から移行した。
`public/_headers` のセキュリティヘッダーは Workers でもそのまま解釈される。
ドメイン: **news.edu-evidence.org**(edu-evidence.org のサブドメイン、CNAME)。
メール: Cloudflare Email Routing で `news@edu-evidence.org` を個人 Gmail に転送。

**Cloudflare のメールアドレス難読化は Workers では効かない**。Pages 配信時は `mailto:`
が `/cdn-cgi/l/email-protection#…` に置換されていたが、Workers では生のアドレスが出る。
不具合ではなく Scrape Shield の仕様で、受容すると決めている(edu-evidence ADR 0032)。

## コンテキスト管理

Claude Code とのセッションは context 圧縮 / `/clear` / セッション終了を跨ぐことがある。重要な決定と進行状態は会話ではなくファイルに残す方針:

- **主要な意思決定** → [`docs/decisions/`](docs/decisions/)(ADR、不変)
- **現在のセッションの作業状態** → `.claude/state/active.md`(生きたチェックポイント、git 追跡外)
- **運用方針の全体** → [`docs/context-management.md`](docs/context-management.md)

`.claude/hooks/pre-compact.sh` と `post-compact.sh` が圧縮時に active.md を dump / 再読込リマインダーを出すよう登録されている(`.claude/settings.json`)。
