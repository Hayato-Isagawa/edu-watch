# 0063. Astro 7 へ移行し XSS advisory 3 件を解消する(edu-evidence ADR 0027 ミラー・edu-watch 差分あり)

- 状態: 採用
- 日付: 2026-07-23
- 関連 PR: —(本 astro 7 移行 PR。作成後に追記)
- 関連 ADR: edu-evidence 0027(原本。移行の全体像と検討した選択肢)/ [`ADR 0060`](0060-visual-regression-testing.md)(VRT で移行を検証)
- 関連: Dependabot security PR #420(astro 6.4.8→7.1.0 提案・本移行で supersede)

## 背景

Dependabot が astro 本体の XSS advisory を 3 件検知した(GHSA-f48w-9m4c-m7f5 #42 / GHSA-7pw4-f3q4-r2p2 #41 / GHSA-4g3v-8h47-v7g6 #38)。修正版は **すべて 7.x のみで 6.x へのバックポートがなく**、「Astro 6 を維持する」ことと「advisory を塞ぐ」ことが両立しない。姉妹サイト edu-evidence が先行して同移行を実施済(ADR 0027 / PR #384)。

本サイトも `dependabot.yml` で astro / @astrojs/react の major 更新を ignore してきたが、その理由(Astro 7 の既定 Markdown プロセッサが Sätteri に変わり自作 remark/rehype を無視する)は **edu-watch には当てはまらない**。edu-watch は週次ダイジェストを frontmatter の `sections[].comment` として持ち、`marked` + DOMPurify で描画しており(`src/pages/digest/[slug].astro`)、**Astro のマークダウンパイプライン(remark/rehype)を一切使っていない**。`.render()` / `<Content />` / `src/plugins/` は存在せず、`astro.config.mjs` に markdown 設定もない。したがって Sätteri 既定化は無影響で、evi で必須だった `markdown.processor = unified()` 迂回(および `@astrojs/markdown-remark` / `unist-util-visit`)は不要。

## 決定(edu-watch 固有)

1. `astro` を `^7.1.3`、`@astrojs/react` を `^6.0.1` へ上げる。edu-watch は React island を 1 つも hydrate しない(`client:*` 0・`.tsx` 0、`react` の import は OG 生成の型のみ)ため react 統合の major 更新は実質無風。
2. `astro.config.mjs` に `compressHTML: true` を明示する。Astro 7 は既定を `true` から `'jsx'` に変えており、日本語テキストの字間や VRT の差分を避けるため v6 挙動を固定する。markdown キーは追加しない。
3. `vite` の直接依存を `^8.0.0` へ上げる(Astro 7 が vite `^8.0.13` を要求。据え置くと install が ERESOLVE する)。`@tailwindcss/vite@4.3.3` は vite 8 に対応済(peer `^5 || ^6 || ^7 || ^8`)で、旧 ignore コメントが述べた `@tailwindcss/vite@4.2.2` の非互換は解消済み。
4. overrides で `neotraverse` を `^1.0.1` に一本化する(Astro 7 が 1.x を要求する一方 textlint が 0.6.18 を hoist し、prerender ビルドが `forEach` 未 export 版を掴んで失敗するため)。冗長になった `esbuild` override は削除する(vite 8 が esbuild 0.28.1 に dedupe)。
5. `js-yaml` の blanket override を `^4.2.0` から `^4.3.0` へ上げ、advisory GHSA-52cp-r559-cp3m(#40・HIGH・YAML merge-key で二次計算量 DoS、patched 4.3.0)を塞ぐ。`^4.2.0` のままでは npm が範囲内で lock を保守し 4.2.0 に留まり 4.3.x へ自動更新されないため、下限を明示的に引き上げる(install で 4.3.0 に解決・単一エントリを実測)。scoped 化せず blanket のままでよいのは、edu-watch のツリーに gray-matter が存在せず(Astro は js-yaml を直接使用)、evi が scoped 化した理由(gray-matter の `safeLoad`/`safeDump` が js-yaml 4 で除去され build が壊れる件)が発生しないため。
6. `dependabot.yml` の astro / @astrojs/react major ignore を削除する。vite の major ignore はコメントを更新のうえ残置(astro が次の vite メジャーを採るまで固定)。typescript の ignore は `@astrojs/check` の peer 制約により残置。

## 帰結

- astro XSS 3 件が解消(`npm audit` から消失)。js-yaml HIGH #40 も override 引き上げで解消。`npm audit --omit=dev` に残る HIGH は svgo 4.0.1(GHSA-2p49-hgcm-8545)1 件のみ — Astro 7 の transitive で本番依存ツリーには入るが、脆弱な経路(astro:assets の画像最適化 / SVG 処理)を edu-watch は使っておらず未到達で、Dependabot alert も無いため astro 上流の更新に委ねる(本 PR スコープ外)。
- Astro のマークダウンパイプラインを使わない構成のため、evi で既知債務とした「`remarkPlugins`/`rehypePlugins` が `processor: unified()` 下で deprecated」問題は edu-watch には存在しない。`@astrojs/markdown-remark` / `unist-util-visit` も deps に追加しない。
- 検証: `astro check` 0 errors・`npm run build` 成功・`check:text` green・`dist/rss.xml` と OG 画像生成・VRT(astro.config 変更で CI 起動)でテンプレ代表ページがピクセル一致・(視覚差分が出た場合のみ)dev 目視サインオフ。実測値は PR に記載。
- Dependabot security PR #420(astro 7.1.0 提案)は本移行(7.1.3)が supersede。マージすると downgrade になるため、本 PR マージ後に手動クローズする。
- 姉妹 2 リポ(edu-law / portfolio)も同一 advisory を抱えるが、本 ADR のスコープは edu-watch のみ。横展開は各リポで個別に build 検証する(edu-law は過去に build 失敗実績あり・portfolio は eslint 9 の別軸あり)。

## 撤回 / 再検討の条件

- Astro が次の vite メジャーを採用したら、`dependabot.yml` の vite major ignore を外して追随を再評価する。
- 将来 edu-watch が Astro のマークダウンパイプラインを使う機能(記事本文の md 描画等)を導入する場合は、Sätteri 既定の挙動を確認し、必要なら evi 同様 `processor: unified()` + `@astrojs/markdown-remark` を追加する。
