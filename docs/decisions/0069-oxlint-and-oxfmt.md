# 0069. lint と整形に oxlint / oxfmt を採用する(edu-evidence ADR 0037 ミラー)

- 状態: 採用
- 日付: 2026-09-12
- 関連 PR: `chore/adopt-oxlint-oxfmt`
- 関連 ADR: edu-evidence ADR 0037(原本)

## 背景

このリポには linter も formatter も無かった。検査は記事の収集・フィルタ・テキスト規約に寄っていて、
`scripts/` `.claude/hooks/` `e2e/` の JS / TS と `.astro` の frontmatter は型検査（`astro check`）以外に見るものが
無い。ファミリーで開発ツールを VoidZero（Vite / Rolldown / Oxc）に揃える方針に沿い、Oxc の oxlint と oxfmt を入れる。
バンドラは Astro 7 経由で Vite 8（内部は Rolldown）を既に使っている。

一次資料（oxc.rs のドキュメント）と実機（oxlint 1.82.0 / oxfmt 0.67.0）で確かめた前提:

- oxlint は `.astro` の frontmatter と `<script>` を lint する（`debugger` を両方で検出）。既定は `correctness`
  カテゴリで、warning でも exit 0
- **oxfmt は `.astro` を扱えない**（対応言語表に無く、Prettier プラグインは Not supported。実機でも対象外）
- 両方とも postinstall を持たず、プラットフォーム別バイナリは optionalDependencies で入る

## 検討した選択肢

1. **oxlint + oxfmt**（採用）。`.astro` の整形は諦める
2. eslint + prettier + prettier-plugin-astro。`.astro` も整形できるが、ファミリーの方針と逆で、速度も劣る
3. lint だけ入れて formatter は入れない。整形の揺れが残る

## 決定

### oxlint

- `.oxlintrc.json`: 既定カテゴリ（correctness）。`no-irregular-whitespace` は `skipComments: true`（コメント内の
  全角空白は日本語の例示で、`.claude/hooks/pre-edit-frontmatter-immutable.cjs` に実在する）。`ignorePatterns` は
  生成物 2 つ（`src/data/articles/**` / `experiments/**`）で oxfmt と共通。`.md` / `.yml` / `.css` は oxlint の
  対象外なので、oxfmt 側の除外は要らない
- 導入時の warning は 6 件。未使用の import 3 件と `new Array(n)` 1 件は直した。`src/lib/normalize.ts` の
  `[...url.searchParams.keys()]` は `unicorn/no-useless-spread` の偽陽性（反復中に `delete` するので先に配列へ
  写す必要がある。外すと削除の直後の要素を飛ばす）で、理由つきの inline ignore にした。残る 1 件は
  `skipComments` で消えた
- `npm run lint` = `oxlint --deny-warnings`。warning で止めないと CI で意味を持たない

### oxfmt

- `.oxfmtrc.json`: `printWidth 80` / `semi` / ダブルクォート / `tabWidth 2` / `trailingComma es5`（姉妹サイトの
  prettier 設定と同じ値）。`sortPackageJson: false`（既定 true は `package.json` のキー順を
  並べ替える。prettier に無い挙動で、`overrides` の並びが動く）
- **対象は oxfmt が検出する言語のうち、次を除いたもの**（`ignorePatterns`）:
  - `**/*.md` — 本文と docs。frontmatter を守る hook があり、CJK の表パディングは見た目が揃わない
  - `**/*.yml` `**/*.yaml` — workflow のガードテスト（`vrt-baseline.test.mjs` 等）が字面で検査している
  - `**/*.css` `**/*.scss` — **整形が本番 CSS を変える。** edu-evidence で `global.css` の `color-mix(...)` を
    複数行に折ると Lightning CSS の出力が `#0059861a` から `oklab(…/.1)` に変わった（同じ色の別表記だが byte 同一
    ではない）。Tailwind の `@theme` CSS は整形の対象にしない
  - `**/*.html` — 生成物
  - `wrangler.jsonc` — 配信設定を 1 バイトも触らない
  - `src/data/articles/**` — `fetch-news.yml` の bot が `JSON.stringify` で書く生成物。整形すると毎週の収集 PR に差分が混じる
  - `experiments/**` — 大部分が gitignore で、追跡分は実験の記録
- `npm run format` = `oxfmt`、`npm run format:check` = `oxfmt --check`（CI）
- 初回整形は同じ PR の別コミット（`style: format with oxfmt`）。lint 修正で触った 5 ファイルだけは第 1 コミットで
  整形も同時に入っている。整形前後で `npm run build` の `dist` は
  `design-tokens.json`（`generatedAt`）を除き byte 一致

### CI

`checks.yml` の job に `Lint (oxlint)` と `Format check (oxfmt)` を足す。required check の集合は変えない — 既存の
required job の中で走る。`link-check-workflow.test.mjs` が 2 つの step の配線と `--deny-warnings` を固定する
（`test:workflows` の下限 63 → 64）。

## 帰結

- `.astro` のテンプレート部は整形されない。oxfmt が Astro を載せたら見直す
- oxfmt は 0.x。minor bump で整形規則が変わると `format:check` が赤になり、public リポの auto-merge は required job を
  待つので止まる。その回は `npm run format` を当てて commit する
- `check:all` は手元用で、CI は同じ script を個別 step で呼ぶ

## 撤回 / 再検討の条件

- oxfmt が `.astro` を扱えるようになったら、対象に含めるかを判断する
- Tailwind / Lightning CSS の出力が整形に依存しなくなったら、CSS を対象に戻す
