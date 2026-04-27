# 0011. UI 状態はセマンティック属性(aria-* / data-*)で管理する

- 状態: 採用
- 日付: 2026-04-27
- 関連 PR: #(本 ADR と同一 PR で確定)

## 背景

EduWatch JP は Sprint 2 でデータパイプライン基盤(7 ソース PR フロー、cron、storage 系)を完成させ、これから Sprint 3 でフロントエンド(Astro による週次サマリ表示・記事一覧 UI など)の実装に入る。

着手前に、UI の状態(メニュー開閉、フィルタ展開、ソート方向、モーダル可視性、テーマ切替など)をどう表現するかの方針を確定しておく必要がある。

姉妹サイト EduEvidence JP では同時期(2026-04-27、PR #118)に同テーマで意思決定を行い、`--open` 修飾子クラスを使わず HTML セマンティック属性(`aria-*` / `data-*`)で UI 状態を表現する方針を採用した(EduEvidence ADR 0007)。EduWatch も同一の運営者・同一の技術スタック(Astro + TypeScript)で動くため、同方針を採用するのが運営コスト・学習コスト・移植性の観点から最も合理的。

## 検討した選択肢

### A) スタイル駆動の修飾子クラス(例: `body.menu-open`, `.filter--expanded`)

- 利点: BEM などの命名規約に沿う、CSS 側の可読性が高い場合がある
- 欠点:
  - 状態がクラス名で表現されるためスクリーンリーダーや支援技術には伝わらない
  - JS が「状態を更新する」のではなく「クラス名を付け替える」関心になり、状態管理と視覚表現が結合する
  - サイト間でフロント実装を移植する際の翻訳コストが高い

### B) HTML 標準のセマンティック属性(`aria-expanded` / `data-state` / `inert` / カスタム `data-*`)

- 利点:
  - `aria-expanded` などは支援技術が既定で解釈する。a11y と視覚状態が一致する
  - JS の関心は「属性を更新する」だけで、見た目は CSS 属性セレクタが追従する
  - 同一属性が DOM 検査・テスト・CSS の共通フックになる
  - Tailwind 4 はネイティブで `data-[state=open]:` `aria-expanded:` などの variant をサポートしている
  - EduEvidence と同一の規約にすることで、コンポーネントを移植しやすい
- 欠点:
  - 属性セレクタは複数値の表現にやや冗長(`data-state="open"` vs クラス `.open`)

## 決定

**B) を採用。EduWatch JP のフロント実装(Sprint 3 以降)で発生するすべての DOM 駆動 UI 状態は、HTML セマンティック属性で表現する。**

### 具体ルール(EduEvidence ADR 0007 と同一)

1. **開閉/可視性のような状態**: `aria-expanded` を支援技術向けの真実の値とし、CSS フック(`data-state="open|closed"`)を併設する
2. **フォーカス制御**: 閉じている領域には `inert` を付与する
3. **複数要素にまたがる状態**: スコープに最も近い祖先要素(典型的には `<body>` または `<html>`)に `data-*` を付ける(命名規約は `data-<scope>` で短く保つ)
4. **スタイルは属性セレクタで参照**: Tailwind の `data-[state=open]:`、`aria-expanded:`、生 CSS の `body[data-menu="open"]` を使う。`is-open` / `--open` 等の修飾子クラスは追加しない
5. **JS の責務**: 状態の更新(`element.dataset.menu = "open"`、`element.setAttribute("aria-expanded", "true")`)のみ。CSS クラスの付け外しで見た目を制御しない
6. **初期値**: クライアント JS 実行前から正しい初期 DOM が得られるよう、サーバー側(Astro)で初期属性を出力する

### EduWatch 固有の想定適用箇所(Sprint 3 以降)

- 週次サマリの「もっと読む」アコーディオン → `<details data-state>` または `<button aria-expanded><div data-state>`
- ソースフィルタ(7 ソースのトグル) → 各ボタンに `aria-pressed`
- 並び順切替(新しい順 / カテゴリ順) → `<select>` または `<div data-sort="date|category">`
- モバイルメニュー → EduEvidence と同じ `aria-expanded` + `data-state` + `inert` + body `data-menu` パターン

## 帰結

### 良い帰結

- 状態の真実が DOM 属性に一元化される(JS / CSS / 支援技術 / E2E テストが同じ属性を見る)
- a11y が「視覚状態に追従する追加実装」ではなく既定で成立する
- EduEvidence と同一規約のため、ヘッダー / メニュー / カードなどのコンポーネントを将来共通化しやすい
- ADR として明文化することで、Sprint 3 以降の実装判断が迷わない

### トレードオフ

- 「複数値の状態」を表すとき `data-state="closed"` のような書き方になり、`.closed` クラス比 1〜2 文字長い
- 共通ライブラリやテンプレートを取り込む際、クラスベースの素材を翻訳する工程が増える

## 撤回 / 再検討の条件

- 将来、属性セレクタが Tailwind / 主要ブラウザでサポート低下した場合(現状の見通しでは発生しない)
- 共同開発者が増え、BEM/CSS Modules 流派の方針を全体採用したほうが学習コストを下げられると判断された場合
- React/Vue のクライアント主導 UI に大きく舵を切り、属性ではなく state hook 主導の表現に移行する場合
