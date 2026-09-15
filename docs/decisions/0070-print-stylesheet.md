# 0070. 印刷スタイルを global.css の 1 ブロックで提供する(edu-law ADR 0029 ミラー)

- 状態: 採用
- 日付: 2026-09-15
- 関連 PR: `feat/print-stylesheet`
- 関連 ADR: edu-law 0029(原本)、0060 / 0068(VRT)

## 背景

週次ダイジェストは職員室や校内研修で配布資料として印刷される用途を想定しているが、
印刷用のスタイルが無く、sticky ヘッダー・ナビ・戻るボタン・シェアボタン・ダーク配色が
そのまま紙に出ていた。記事カードの外部リンク(報道・一次資料)は紙では辿れない。
edu-law が ADR 0029 で先に決めた形を写す。

## 検討した選択肢

1. **`src/styles/global.css` 末尾の `@media print` ブロック 1 つ**(採用)。テンプレは触らない
2. テンプレに Tailwind の `print:` variant を散らす。差分がページごとに散り、新しいテンプレで付け忘れる
3. 印刷専用ページ・印刷ボタンの新設。ブラウザの印刷機能で足りる

## 決定

- **画面描画には一切影響させない。** `@media print` の外に書かない。VRT が 0 diff で通ることが
  「画面を変えていない」の実測になる
- **トークンの上書きは `:root` にだけ書く。** `[data-theme="dark"] { … }` や `@theme` のブロックを
  増やすと `src/pages/design-tokens.json.ts` がそれも集約し、公開 `/design-tokens.json` が印刷値に
  化ける。`[data-theme="dark"]` と global.css の後続規則は unlayered なので、末尾の `:root` は
  同じ詳細度の後置として dark の上書きに勝つ(edu-law がビルド成果物で実測)。dark が上書きする
  11 個(`bg` / `ink` / `sub` / `line` / `card` / `accent` / `accent-hover` / `chart-red` /
  `change-add` / `change-update` / `change-fix`)をすべて light 値で再宣言する
- **素の要素セレクタ(`a` 等)は書かない。** unlayered は Tailwind の全ユーティリティに勝つ。
  下線リンク(`.link-underline`)と本文(`main .prose-digest a`)に限定する。本文の `.prose-digest a`
  はページ内 `<style is:global>` が global.css の後で同じ詳細度でアクセント色を塗るので、
  `main` を足して勝たせる
- **媒体バッジ(`[data-source]`)は輪郭型に落とす。** SourceBadge は色地に白文字の inline style
  で、ブラウザの印刷は既定で背景を刷らないので、白紙にほぼ白の文字だけが残る。透明地・文字色
  継承・`--color-line` の枠線にする(inline style に勝つには `!important` が要る)。edu-law の
  バッジは文字色主体なのでこの項は原本に無い
- **外部リンクは `::after` で URL を併記する。** 記事カード・関連リンク・about は
  `main a[target="_blank"]`、ダイジェスト本文は marked + DOMPurify の出力で `target` が付かないので
  `main .prose-digest a[href^="http"]` で拾う(edu-law は `rehype-external-links` が `target` を付ける
  ので `target` だけで足りる。この差は PR 前レビューで検出)。`overflow-wrap: anywhere` を付けないと
  長い URL が 320px 幅で横に溢れる。OECD 帰属の `[data-attribution]` は生 URL を含むので同じく付ける
- **サイトフッターは丸ごと消さない。** 説明文・購読・「探す」「サイト」(姉妹サイト含む)は落とし、
  お問い合わせと「© / CC BY-SA 4.0」は残す。配布物から帰属・ライセンス表示・連絡先を落とさない
  ため。edu-watch のフッターには aria 属性が無いので、`body > footer` からの構造セレクタで指す
- **`break-inside: avoid` は `li` と `blockquote` だけ。** `<article>` はダイジェスト詳細で main の
  中身全部を包む外側・セクション・記事カードの 3 粒度で使われており、外側に付けると改ページの
  制御が逆に崩れる
- **検査は `e2e/print.spec.ts`。** `colorScheme: "dark"` で `emulateMedia({ media: "print" })` し、
  chrome の非表示・配色・本文リンクの色と下線・バッジの塗り・URL 併記・ライセンス行・320px の
  横溢れを見る。残す要素は `toBeVisible` で見る(`toContainText` は `display: none` を通す)。
  本文リンクの色は `toHaveCSS` で見る(150ms の `transition` が終わるまで待つ)。対象は最新の
  ダイジェスト詳細と `/about/`、本文リンクの検査は本文に外部リンクを持つ最新の号(本文リンクの
  無い号が 21 号中 8 号ある)。トップは直近 7 日の記事データに依存し、収集が止まると外部リンクが
  0 件になるので URL 併記の断定には使わない。`#menu-toggle` は 1280 幅では画面でも非表示で判別力が
  無いので、768 幅の断面を別に持つ
- **Playwright の spec を Tailwind の自動ソース検出から外す(`@source not "../../e2e"`)。** spec の
  文字列(`"underline"`)がユーティリティとして拾われ、画面用 CSS に使われない規則が載っていた
  (ビルド比較で検出)。`vrt/` は同じ経路だが本 PR では触らない

## 結果

- 印刷は A4 でダイジェスト詳細(2026-09-13 号)5 ページ、about 3 ページ(2026-09-15 時点、
  `page.pdf` で実測)
- 変異試験: `--color-bg` / `.site-header nav` / `::after`(全体・本文側だけ)/ `main .prose-digest a` /
  `[data-source]` の塗り消し / `.share-link` / フッター説明文・購読の非表示 / `.link-underline` /
  `#menu-toggle` を 1 つずつ抜くと、それぞれ対応するテストが赤になる(10 件とも実測)。
  `color-scheme: light` と `#reading-progress`(画面でも `scaleX(0)` で bounding box が空)は
  テストで固定していない
- `<details>` は src / dist とも 0 件なので開閉の処理は入れていない。使い始めたら足す
- 印刷ボタンは置かない。必要になったら別 ADR
