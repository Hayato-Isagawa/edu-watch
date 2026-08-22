// OG 画像のキャッシュバスティング用バージョン(ADR 0067)
// SNS は og:image を URL 単位でキャッシュするので、画像の中身を変えても
// URL が同じだと古いカードが残る。X には公式のリフェッチ手段が無く、
// クエリで別 URL 化するのが唯一の手段になる。

// 静的 default OG(/og-image.png)。public/og-image.png の見た目が変わったら生成日に更新する
export const OG_DEFAULT_VERSION = "20260715"; // ブランド行をヘッダー表記に揃えた日(#394)

// 動的 OG(/og/digest/<slug>.png)。号ごとではなく全 digest 共通の 1 つ。
// OG 画像の見た目が変わる変更をしたら変更日に更新する:
//   - src/lib/og-image.ts のレイアウト変更(全号に効く)
//   - 個別号の title / topics / weekStart / weekEnd の編集(その号だけ効く)
// 後者でも全号の URL が変わるが、SNS が再取得する枚数が増えるだけで害はない。
// 号ごとに版を持たせないのは、frontmatter の publishedAt が一覧の並び順・公開日表示・
// RSS の pubDate を兼ねており、キャッシュ更新日を上書きすると読者向けの表示が壊れるため。
export const OG_DIGEST_VERSION = "20260822"; // title を 2 行に分割した日(#553)
