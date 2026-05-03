# 0028. ダークモードのトークン値を可読性重視に再調整する

- 状態: 採用
- 日付: 2026-05-03
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0026(dark mode data-theme with system default)
- 姉妹サイト ADR: edu-evidence ADR 0013(本 ADR の起点)

## 背景

ADR 0026 で edu-evidence ADR 0011 をミラーする形で採択したダークモード値で本番運用したところ、「沈んだ」「読みにくい」体感が確認された。姉妹サイト edu-evidence は ADR 0013 で同じ問題に対応し、greyscale 系トークンを react.dev / GitHub と同水準の中性 dark gray 帯に再調整する。

両サイトでダークの色味が分かれると姉妹サイトとしての印象が崩れるため(memory rule 7)、本サイトも同等の調整を行う。

## 決定

edu-evidence ADR 0013 と同仕様の greyscale 値を edu-watch にも適用する。アクセント色(edu-watch 固有のディープネイビー由来 `#6fa8d3`)はブランド色として維持する。

詳細な背景・選択肢比較・コントラスト比・参照ソース(react.dev 本体 CSS bundle / Primer 公式リポジトリ)は [edu-evidence ADR 0013](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0013-dark-mode-readability-tuning.md) を参照。本 ADR は edu-watch 側の採択記録。

### 新しい dark 値

| token | ADR 0026(旧) | ADR 0028(新) | 備考 |
|---|---|---|---|
| `--color-bg` | `#0f1413` | **`#16181d`** | edu-evidence と共通 |
| `--color-ink` | `#e8e6df` | **`#f0f6fc`** | edu-evidence と共通 |
| `--color-sub` | `#9a9a92` | **`#9ba1a8`** | edu-evidence と共通 |
| `--color-line` | `#2a2f2c` | **`#30363d`** | edu-evidence と共通 |
| `--color-card` | `#161b18` | **`#1f2328`** | edu-evidence と共通 |
| `--color-accent` | `#6fa8d3` | **維持** | edu-watch 固有のブランド色(ディープネイビー由来) |
| `--color-chart-red` | `#f08070` | **維持** | edu-evidence と共通、変化なし |

### コントラスト比(本サイト固有)

- 本文 `#f0f6fc` × 背景 `#16181d`: 約 16:1(AAA)
- サブ文字 `#9ba1a8` × 背景 `#16181d`: 約 7.5:1(AAA)
- アクセント `#6fa8d3` × 背景 `#16181d`: 約 8.5:1(AAA、edu-watch のディープネイビー由来 dark バリエーション)

### 維持する設計

- 起動方式 / トークンセマンティクス: ADR 0026 のまま
- ライトテーマ: 完全維持
- ヘッダーのテーマトグル配置(ADR 0026 + lg-mid breakpoint 統一): 変更なし

## 観測

- 本番(または preview)で代表ページ(トップ / ダイジェスト個別 / カテゴリ / アーカイブ)を Mac Safari / iPhone Safari の OS dark で目視確認

## 関連参照

- edu-evidence ADR 0013(本 ADR の起点)
- ADR 0026(本 ADR の前提)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
