# 0023. ファーストビュー(Hero)は縦積み + 大型 H1 を共通スタイルとする

- 状態: 採用
- 日付: 2026-05-02
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: edu-watch 0011(semantic attribute state、edu-evidence 0007 ミラー)/ 0016(linear accent bar、edu-evidence 0008 ミラー)
- 姉妹サイト ADR: edu-evidence 0009(本 ADR の起点)

## 背景

edu-evidence と edu-watch は Layout / global.css / デザイントークンを共有しているが、ファーストビュー(各ページ冒頭の `<section>`)の文法が分かれていた:

- **edu-evidence**(本 ADR ミラー以前): 12-col grid の 2 列レイアウト(左 8 に kicker + H1、右 4 に説明文)、H1 は `text-5xl md:text-7xl`(トップ)/ `text-5xl md:text-6xl`(他)
- **edu-watch**(本 ADR 適用前): 縦積みレイアウト(kicker → H1 → 説明文)、ただし H1 は `text-3xl sm:text-4xl md:text-5xl` で edu-evidence より明らかに小さい

2026-05-02、edu-evidence 側で ADR 0009 が採択され、両者の良いところ取りで「縦積み + 大型 H1 + `max-w-2xl` 説明文」を共通仕様化することが決まった。本 ADR は edu-evidence ADR 0009 を edu-watch にミラーし、姉妹サイト間で完全に揃った FV 規約を成立させる。

## 検討した選択肢

選択肢の検討内容は edu-evidence ADR 0009 と同一(縦積み + 大型 H1 採用)。本 ADR では以下の差分のみ判断する:

### A) edu-evidence の規約をそのままミラーする(採用)

- 利点: 姉妹サイト間で完全に揃う、保守性が高い
- 欠点: なし(edu-watch の現状縦積み構造とも整合する、変更点は H1 サイズと余白のみ)

### B) edu-watch 独自に小さめ H1 を維持する

- 利点: 現状の実装が変わらない
- 欠点: 姉妹サイト間で印象が揃わない、ストック型(edu-evidence)とフロー型(edu-watch)で H1 サイズが違うことに合理性がない

## 決定

edu-evidence ADR 0009 をそのままミラーする。

### 構造(edu-evidence ADR 0009 と同一)

```html
<section class="pt-10 sm:pt-14 md:pt-20 lg:pt-28 pb-10 sm:pb-14 md:pb-20 border-b border-[var(--color-line)]">
  <p class="font-mono text-xs uppercase tracking-widest text-[var(--color-accent)]">
    {Kicker テキスト}
  </p>
  <h1 class="mt-5 font-black text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.15] tracking-tight">
    {ページの主見出し}
  </h1>
  <div class="mt-6 max-w-2xl text-[var(--color-sub)] leading-loose text-sm sm:text-base">
    {説明文}
  </div>
</section>
```

### 決定値

| 要素 | 値 |
|---|---|
| H1 レスポンシブ | `text-4xl sm:text-5xl md:text-6xl lg:text-7xl`(36px → 48px → 60px → 72px) |
| H1 line-height | `leading-[1.15]` |
| H1 letter-spacing | `tracking-tight` |
| H1 font-weight | `font-black`(900) |
| 説明文の最大幅 | `max-w-2xl`(672px) |
| 説明文の line-height | `leading-loose` |
| Kicker | `font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent)]`(edu-watch 既存実装の `text-[10px]` を維持。`text-xs` への統一は後続 PR で検討) |
| Section padding | `pt-10 sm:pt-14 md:pt-20 lg:pt-28 pb-10 sm:pb-14 md:pb-20`(下端は次セクションへの接続度合いに応じて pb 削減可) |

### 適用先

- 全 FV ページ(トップ / ダイジェスト一覧・個別 / カテゴリ別・媒体別 / アーカイブ / About / changelog / 検索 / 404)
- 個別記事系ページ(ダイジェスト個別)は H1 を 1 段下げ `text-3xl sm:text-4xl md:text-5xl lg:text-6xl` を許容(edu-evidence ADR 0009 例外節と同一)

## アクセシビリティ

edu-evidence ADR 0009 と同一(WCAG SC 1.3.2 / 1.4.4 / 1.4.10 / 2.4.6 達成、既存コントラストトークン維持)。

## 関連参照

- edu-evidence `docs/decisions/0009-stacked-hero-with-large-h1.md` — 本 ADR の起点
- 当リポジトリ `src/styles/global.css` — デザイントークン定義
