# 0025. 本文フォントはシステムフォントスタックに統一し Web フォントを廃止する

- 状態: 採用
- 日付: 2026-05-03
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0011(semantic attribute state、edu-evidence 0007 ミラー)
- 姉妹サイト ADR: edu-evidence 0010(本 ADR の起点)

## 背景

これまで `src/styles/global.css` 冒頭で `@fontsource-variable/noto-sans-jp` と `@fontsource-variable/jetbrains-mono` を `@import` し、`--font-sans` / `--font-mono` の最優先に Web フォント名(`"Noto Sans JP Variable"` / `"JetBrains Mono Variable"`)を置いてきた。Cloudflare Pages 経由で self-host し、CSP `font-src` を `'self'` に絞っていた。

しかし本番閲覧では、初回ペイント時に **fallback の serif(ブラウザデフォルトの Times 系)が一瞬表示され、woff2 ロード完了後に Noto Sans JP に置換される FOUT(Flash of Unstyled Text)** が知覚される問題が残っていた。読み手は「最初は明朝で表示され、その後フォントが当たる、カクっとした切り替え」を体験する。原因の構造は edu-evidence ADR 0010 と同一(`font-display: swap` × `--font-sans` 最優先 Web フォント × Noto Sans JP の subset 分割によるロード遅延)。

姉妹サイト edu-evidence は ADR 0010 で同方針を採択し、Web フォントを廃止する。edu-watch は edu-evidence と Layout / global.css / デザイントークンを共有しており、フォント挙動が両サイトで分かれると姉妹サイトとしての印象が崩れる(memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」)。

## 決定

edu-evidence ADR 0010 と同仕様を edu-watch にもミラーする。本サイトの本文フォントもシステムフォントスタックに統一し、Web フォントを廃止する。

詳細な背景・選択肢比較・受容できる欠点・観測項目は [edu-evidence ADR 0010](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0010-system-font-stack-no-webfont.md) を参照。本 ADR は edu-watch 側の採択記録であり、edu-evidence 側との不整合を生まないことを目的とする。

### 新フォントスタック

```css
:root {
  --font-serif: "Hiragino Mincho ProN", "Yu Mincho", serif;
  --font-sans: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", "Meiryo", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace;
}
```

### 適用範囲

- 本サイトの全ページ(SSG された全ページ)
- 動的 OG 画像(該当ファイルがあれば別 PR で対応)

### 削除する依存

- `@fontsource-variable/noto-sans-jp`
- `@fontsource-variable/jetbrains-mono`

## 観測

- 本番 URL を Mac Safari / Chrome / iPhone Safari / Windows Chrome 等で目視確認し、FOUT が消えていること
- 既存の Lighthouse 計測値を維持または改善

## 関連参照

- edu-evidence ADR 0010(本 ADR の起点、詳細議論はそちら)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
