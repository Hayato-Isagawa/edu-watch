# 0026. ダークモードはシステム追従デフォルト + 手動切替トグル(`data-theme` 属性)で提供する

- 状態: 採用
- 日付: 2026-05-03
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0011(semantic attribute state management)/ 0025(system font stack)
- 姉妹サイト ADR: edu-evidence ADR 0011(本 ADR の起点)

## 背景

姉妹サイト edu-evidence は ADR 0011 でダークモードを採択する。本サイト edu-watch も Layout / global.css / デザイントークンを共有しており、フォント挙動と同様、テーマ挙動が両サイトで分かれると姉妹サイトとしての印象が崩れる(memory rule 7)。

加えて、本サイトはダイジェスト・ニュース性のページが多く、夜間のスマートフォンでの斜め読み・通勤時の閲覧が想定される。ダーク端末で「edu-evidence はダークだが edu-watch はライト」になると違和感が大きい。

## 決定

edu-evidence ADR 0011 と同仕様を edu-watch にもミラーする。本サイトもダークモードをサポートし、起動方式は **方式 B(システム追従デフォルト + 手動切替トグル + localStorage 永続化)**、起動属性は `data-theme="dark"` / `data-theme="light"`(ADR 0011「semantic attribute state management」と整合)を採用する。

詳細な背景・選択肢比較・カラートークン値の決定基準・初期解決スクリプト・Tailwind 4 連携・アクセシビリティ要件は [edu-evidence ADR 0011](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0011-dark-mode-data-theme-with-system-default.md) を参照。本 ADR は edu-watch 側の採択記録であり、edu-evidence 側との不整合を生まないことを目的とする。

### edu-watch 固有のカラー差分

アクセント色だけ edu-watch のブランド色に合わせて再定義する(他の token は edu-evidence と同じ値を使用)。

```css
[data-theme="dark"] {
  --color-bg: #0f1413;
  --color-ink: #e8e6df;
  --color-sub: #9a9a92;
  --color-line: #2a2f2c;
  --color-card: #161b18;
  /* edu-watch のディープネイビー #1e4a6e を、ダーク背景上で AA 以上の
     コントラストを確保できる明度に上げる */
  --color-accent: #6fa8d3;
  --color-accent-hover: color-mix(in oklab, var(--color-accent) 85%, white);
  --color-chart-red: #f08070;
}
```

`--color-accent` 決定の根拠:

- ライトの `#1e4a6e` をダーク背景にそのまま乗せると視認性が大きく落ちる(コントラスト比 < 3:1)
- 明度を上げた `#6fa8d3` で `#0f1413` 背景に対して AA(4.5:1)を達成
- 葉モチーフの edu-evidence 緑(ダーク版 `#6fbe87`)と隣接色相で姉妹感を維持

### 適用範囲

- 本サイトの全ページ
- 動的 OG 画像は対象外(これはサーバーサイド画像生成、テーマ概念がそもそも無い)

## 観測

- 本番 URL を Mac Safari / iPhone Safari で OS のダークモード ON/OFF それぞれで目視確認
- トグルクリック → リロード後も同じテーマが維持されることを確認
- a11y baseline が空のまま維持されること

## 関連参照

- edu-evidence ADR 0011(本 ADR の起点、詳細議論はそちら)
- ADR 0011 semantic attribute state management(`data-theme` 採用の根拠)
- ADR 0025 system font stack(同セッションで採択した姉妹規約)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
