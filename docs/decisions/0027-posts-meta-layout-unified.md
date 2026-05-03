# 0027. 投稿系ページ(ダイジェスト)のメタ配置を姉妹サイトで統一する

- 状態: 採用
- 日付: 2026-05-03
- 関連 PR: 本 ADR と同一 PR で確定
- 関連 ADR: 0023(stacked hero with large H1、edu-evidence ADR 0009 ミラー)
- 姉妹サイト ADR: edu-evidence ADR 0012(本 ADR の起点)

## 背景

姉妹サイト edu-evidence は ADR 0012 で投稿系ページ(コラム個別 / 一覧)のメタ配置規約を確定する。本サイトのダイジェスト個別ページの構造はすでにその規約とほぼ同じだが、次の細部が edu-evidence の更新後と一致しない:

- kicker font-size が `text-[10px]`(edu-evidence は `text-xs`)
- 一覧ページの公開日が「曜日付き」(edu-evidence は曜日なしに統一)

姉妹サイト間で投稿系の見え方が分裂しないよう、これらを edu-evidence ADR 0012 と完全に揃える。

## 決定

edu-evidence ADR 0012 と同仕様を edu-watch のダイジェストページにも適用する。

詳細な背景・メタ配置規約・選択肢比較・アクセシビリティ要件は [edu-evidence ADR 0012](https://github.com/Hayato-Isagawa/edu-evidence/blob/main/docs/decisions/0012-posts-meta-layout-unified.md) を参照。本 ADR は edu-watch 側の採択記録であり、edu-evidence 側との不整合を生まないことを目的とする。

### 適用範囲(本サイト固有の差分)

| 要素 | 変更内容 |
|---|---|
| ダイジェスト個別ページの kicker font-size | `text-[10px]` → `text-xs`(edu-evidence と同一) |
| ダイジェスト個別ページの公開日(`公開:`)| `weekday: short` 付きの Intl 整形に統一(週の期間 `weekStart 〜 weekEnd` は曜日なしのまま、行幅維持) |
| ダイジェスト一覧ページの公開日 | `weekday: short` を **外す**(`2026年5月3日(土)` → `2026年5月3日`、行幅を抑え一覧密度を改善) |
| 戻る link 位置 | header 末尾(現状のまま、変更なし) |
| H1 サイズ | ADR 0023 の個別記事例外節のまま(変更なし) |

### ダイジェスト固有のメタ要素(維持)

- `期間 〜 期間` の表示(週次性の表現として必須)、kicker 直下のメタ行内に `公開:` と並列で配置
- TopicBadge(コンテンツの分類タグとして維持)

## 観測

- 本番 URL を Mac Safari / iPhone Safari で目視
  - 一覧の公開日が「2026年5月3日」のように曜日なしで表示されること
  - 個別の公開日が「2026年5月3日(土)」のように曜日付きで表示されること
  - kicker サイズが edu-evidence のコラムページと一致すること

## 関連参照

- edu-evidence ADR 0012(本 ADR の起点、詳細議論はそちら)
- ADR 0023 stacked hero(H1 サイズ規約は本 ADR の対象外)
- memory rule 7「edu-watch の UI/UX は edu-evidence に揃える」
