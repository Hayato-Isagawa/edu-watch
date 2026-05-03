# 0029. 本文タイポグラフィを可読性重視にチューニングする

- 状態: 採用
- 日付: 2026-05-03
- 関連 PR: 本 ADR と同一 PR で確定(ADR 0028 と同 PR にバンドル)
- 関連 ADR: 0025(system font stack)/ 0028(dark mode readability tuning)
- 姉妹サイト ADR: edu-evidence ADR 0014(本 ADR の起点)

## 背景

ADR 0028 で edu-evidence ADR 0013 をミラーする形で dark の greyscale 値を再調整し背景・本文色の階調は改善されたが、本番運用で **本文(`.prose-digest` / `.prose-article`)が依然として「読みにくい」「薄く感じる」** というフィードバックが残った。姉妹サイト edu-evidence は ADR 0014 で同じ問題に対応する。

両サイトでタイポグラフィの読み味が分かれると姉妹サイトの印象が崩れるため(memory rule 7)、本サイトも同等の調整を行う。

## 決定

edu-evidence ADR 0014 と同仕様の改善を edu-watch にも適用する。

詳細な背景・選択肢比較・原因分析(`-webkit-font-smoothing: antialiased` の問題、業界標準の本文サイズ・行間)は [edu-evidence ADR 0014](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0014-prose-typography-readability-tuning.md) を参照。本 ADR は edu-watch 側の採択記録。

### 変更内容

```diff
 html {
   font-family: var(--font-sans);
   background: var(--color-bg);
   color: var(--color-ink);
   font-feature-settings: "palt";
-  -webkit-font-smoothing: antialiased;
   text-rendering: optimizeLegibility;
   ...
 }

 /* global.css */
 .prose-article {
-  font-size: 16px;
-  line-height: 1.95;
+  font-size: 17px;
+  line-height: 1.8;
 }

 /* src/pages/digest/[slug].astro の inline style */
 .prose-digest {
   color: var(--color-ink);
-  font-size: 1rem;
-  line-height: 1.85;
+  font-size: 17px;
+  line-height: 1.8;
 }
```

### 本サイト固有の差分

- edu-evidence は `.prose-article` のみが本文だが、edu-watch はダイジェスト個別の `.prose-digest`(`src/pages/digest/[slug].astro` 内 inline style)が主たる本文。両方を同じ値に揃える
- `.prose-article` は本サイトのテンプレで実際に使用されていない(edu-evidence からコピーされた残置コード)が、姉妹サイト一貫性のため edu-evidence と同じ値に揃えておく

### 維持する要素

- `text-rendering: optimizeLegibility` / `font-feature-settings: "palt"`: 維持
- system-font-stack(ADR 0025): 維持
- `.prose-article` / `.prose-digest` の段落・見出し・リスト・引用組版規約: 変更なし

### 注: PR 構成

本 ADR は ADR 0028(dark greyscale tuning)と同 PR にバンドルする。理由は edu-evidence ADR 0014 と同様(ユーザーフィードバックの起点が同じ、preview 確認の二度手間回避)。

## 観測

- preview デプロイで代表ページ(ダイジェスト個別 / トップ / カテゴリ)の本文を Mac Safari / iPhone Safari の light/dark 双方で目視
- light テーマで本文が「太く感じる」副作用が無いこと

## 関連参照

- edu-evidence ADR 0014(本 ADR の起点)
- ADR 0025(system font stack、本 ADR の前提)
- ADR 0028(dark mode readability tuning、同 PR にバンドル)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
