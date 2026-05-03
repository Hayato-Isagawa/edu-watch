# 0030. ダーク本文 ink を react.dev の gray-15(`#D0D3DC`)に再微調整する

- 状態: 採用
- 日付: 2026-05-04
- 関連 PR: 本 ADR と同一 PR で確定(ADR 0028 / 0029 と同 PR にバンドル)
- 関連 ADR: 0028(dark mode readability tuning)
- 姉妹サイト ADR: edu-evidence ADR 0015(本 ADR の起点)

## 背景

ADR 0028 / 0029 投入後の preview 確認で 3 段階のフィードバックが続いた(姉妹サイト edu-evidence で同様):

1. **第 1**: 「`#f0f6fc` は GitHub の青寄り、edu-watch のアクセント青(`#6fa8d3`)と干渉する」 → 第 1 試行で `#F6F7F9`(react.dev gray-5)に変更
2. **第 2**: 「`#F6F7F9` は白が強すぎて目にきつい」 → 第 2 試行で `#EBECF0`(react.dev gray-10)に明度を 1 段下げ
3. **第 3**: 「`#EBECF0` でももう少し明るさを抑えたい」 → 第 3 試行(本 ADR 確定版)で `#D0D3DC`(react.dev gray-15、明度 85%)にさらに 1 段下げ

姉妹サイト edu-evidence は ADR 0015 で同じ方針(react.dev の gray ランプ内で 2 段下げ)を採択した。両サイトで本文色が分かれると姉妹サイトの印象が崩れるため(memory rule 7)、本サイトも同等の再微調整を行う。

詳細な背景・原因分析(Optimistic Text vs Hiragino W3 のフォント環境差)・選択肢比較は [edu-evidence ADR 0015](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0015-ink-token-react-dev-gray-15.md) を参照。

## 決定

`--color-ink`(dark)を **`#D0D3DC`** に変更する。

```diff
 [data-theme="dark"] {
   --color-bg: #16181d;
-  --color-ink: #f0f6fc;
+  --color-ink: #D0D3DC;
   --color-sub: #9ba1a8;
   --color-line: #30363d;
   --color-card: #1f2328;
   --color-accent: #6fa8d3;
   --color-chart-red: #f08070;
}
```

### コントラスト確認

- 本文 `#D0D3DC` × 背景 `#16181d`: 約 **11.6:1**(AAA)
- サブ文字 `#9ba1a8` × 背景: 7.5:1(AAA、階層差 ~22pt)
- アクセント `#6fa8d3` × 背景: 8.5:1(AAA、変化なし)

### 維持する設計

- ADR 0028 で更新したその他のトークン(bg / sub / line / card): 変更なし
- アクセント色(edu-watch のディープネイビー由来 dark `#6fa8d3`): 維持
- ライトテーマ: 完全維持

## 経緯(本セッションの試行履歴)

| 試行 | 値 | react.dev での位置 | 採否 |
|---|---|---|---|
| ADR 0028 当初 | `#f0f6fc` | (GitHub fg、青寄り) | 却下 |
| ADR 0030 第 1 試行 | `#F6F7F9` | gray-5 / primary-dark | 却下 |
| ADR 0030 第 2 試行 | `#EBECF0` | gray-10 / secondary-dark | 却下 |
| ADR 0030 第 3 試行 / 確定版 | **`#D0D3DC`** | gray-15(明度 85%) | **採用** |

## 関連参照

- edu-evidence ADR 0015(本 ADR の起点)
- ADR 0028(本 ADR の前段階)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
