# 0012. NIER ソースを RSS から HTML スクレイピングへ切り替え

- 状態: 採用(ADR 0007 の Tier 1 / NIER 行を上書き、ADR 0008 の引用範囲遵守 5 要件と整合)
- 日付: 2026-04-27
- 関連 PR: #18(初版 RSS 実装)、TBD(本 ADR の実装)

## 背景

Sprint 2 完了後の運用観察(2026-04-26〜27)で、NIER の保存済み記事 19 件中、複数の記事の `sourceUrl` が **個別記事ページではなく `/02_news/` トップやセクション/カテゴリページ**になっていることが判明した。

実例:

| RSS の title | RSS の `<link>`(=保存された sourceUrl) |
|---|---|
| 「『データ駆動型教育』の課題と実現可能性に関する調査研究」報告書を掲載しました。 | `https://www.nier.go.jp/02_news/`(トップ!) |
| 「老朽化した学校施設の…」報告書を掲載しました。 | `https://www.nier.go.jp/02_news/`(同上、トップ) |
| 「『全国学生調査』の…」報告書を掲載しました。 | `https://www.nier.go.jp/02_news/`(同上、トップ) |
| 全国学力・学習状況調査の中学校英語… | `https://www.nier.go.jp/02_news/26chousa/eng/rwl.html`(個別) |
| 連携協定を締結しました。 | `https://www.nier.go.jp/02_news/_uploads/.../renkeikyotei_teiketsu.pdf`(PDF 直) |

調査の結果、これは parser のバグではなく **NIER の RSS 配信仕様**が「個別記事 URL を保証しない」ことが原因。トップページ HTML(`https://www.nier.go.jp/02_news/`)の `<a class="c-newslist__link">` の href には個別記事 URL が確実に入っているが、RSS 側はそれを反映していない。

ADR 0008 の編集ポリシー(「一次情報リンクを冒頭に必須配置」「読者を一次情報の発信元に届ける」)を実質的に満たすため、RSS を諦めて HTML スクレイピングに切り替える。

## 検討した選択肢

### A. 現状維持(NIER の RSS をそのまま使う、却下)

カテゴリ/トップ URL に飛ぶケースを許容。読者は NIER のサイト内で目当ての報告書を再検索する必要があり、ADR 0008 の精神に反する。

### B. HTML スクレイピングに切り替え(採用)

`https://www.nier.go.jp/02_news/` の `<ul class="c-newslist">` を cheerio でパース。各 `<li class="c-newslist__item">` から:

- `<time class="c-newslist__date" datetime="YYYY-MM-DD">` → publishedAt
- `<a class="c-newslist__link" href>` → 個別記事 URL(href) + タイトル(text)
- `<span class="c-newslist__category" data-category>` → summary 代用(現状の RSS 版は `contentSnippet` 由来の summary を持っていたが、HTML 版はカテゴリ文字列で代替)

href は `/26chousa/...` 形式の絶対パスで返る場合と、`/02_news/...` で返る場合が混在しているため `https://www.nier.go.jp` をベースとして resolve する。`http` 始まりの絶対 URL も受け入れ可能にしておく。

トップページ内に同じ href が複数の `<ul class="c-newslist">` セクションに出現するケースがある(観察値: 27 件中 1 件重複)ため、parser 内で href ベースの dedupe を 1 段かける。

### C. NIER ソース停止(却下)

教育研究の中核的な一次情報源を 1 つ失う。edu-watch の Tier 1 として外せない。

## 決定

B を採用する。`src/lib/sources/nier.ts` を rss-parser ベースから cheerio ベースの HTML scraper に置換する。

実装上の注意点:

- 取得タイムアウト 10 秒、`User-Agent: edu-watch/1.0 (+https://news.edu-evidence.org)` は既存と統一
- `datetime` 属性が `YYYY-MM-DD` 形式の日付のみのため、`T00:00:00.000Z`(UTC 0 時)で ISO8601 化する。RSS 版は時刻情報を持っていたが、HTML 版は日付精度のみ
- `<time>` / `<a>` / `datetime` のいずれかが欠ける `<li>` はスキップする
- href dedupe で同セッション内の重複を除外

## 影響

- 個別記事ページが `sourceUrl` に確実に入るようになる(ADR 0008 の引用範囲遵守 5 要件のうち「公式 URL 直リンク」を実質的に満たす)
- publishedAt の精度が「日付のみ」になる(時刻 `T00:00:00.000Z`)。RSS 版の時刻情報は失われるが、edu-watch の表示単位は日付なので影響は無視できる
- `summary` がカテゴリ文字列(「研究・事業活動」「イベント」「採用情報」)に変わる。RSS 版の `contentSnippet`(NIER 共通の定型紹介文)よりむしろ情報量が高い
- HTML 構造変更時は parser を更新する必要がある(RSS なら URL 変更時のみで済んだが、トレードオフとして許容)

## 撤回 / 再検討の条件

- NIER が RSS で個別記事 URL を返すように仕様変更した場合 → RSS 版に戻す
- HTML 構造が大きく変更され、`ul.c-newslist > li.c-newslist__item` が消失した場合 → セレクタを更新するか、再度 RSS / 別経路を検討
