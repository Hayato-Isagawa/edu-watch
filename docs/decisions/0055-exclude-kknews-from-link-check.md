# 0055. リンクチェックから kknews.co.jp を除外する

- 状態: 採用
- 日付: 2026-06-09
- 関連 issue: #256（#105 / #204 の再発を恒久解消）
- 関連 PR: `ci/link-check-exclude-kknews`

## 背景

週次の自動リンクチェック（lychee、`.github/workflows/link-check.yml`、毎週月曜 00:00 UTC）は、リンク切れ検出時に `needs-human-review` ラベル付き issue を自動生成する。2026-06-08 の run が生成した #256 は「リンク切れ 294 件」を報告したが、調査の結果これは偽陽性と確定した。

- 報告された 583 entries（ユニーク 168 URL）はすべて `www.kknews.co.jp`（教育家庭新聞）。内訳は `[TIMEOUT]` 289 + `[ERROR] (cached)` 294 で、いずれも「CI から kknews へ応答が来ない」同一原因（cached は前回失敗の lychee キャッシュ）。
- 通常の家庭用 IP から 168 URL を全数 curl 検証したところ、168/168 が HTTP 200・サブ秒で応答した。ブラウザ UA・デフォルト UA いずれでも 200。
- すなわち kknews は GitHub Actions ランナー（データセンター IP）を IP ベースでブロック／極端に遅延させており、リンク自体は人間からは正常に閲覧できる。
- workflow は既に `--accept ...,403,429,503` を許容しているが、kknews はステータスを返さず完全タイムアウトするため accept では救済できない。timeout / retry の増加やブラウザ UA 付与も、応答自体が返らない IP 起因の事象には無効。
- 同種の自動 issue #105（2026-05-07）・#204（2026-05-25）はいずれもコメントなしで手動クローズされており、恒久対策がないまま再発し続けていた。
- kknews は ADR 0007 で第 2 層（教育専門紙）の中核に据えた、頻繁に引用する一次情報源。

CI から kknews へ到達できない以上、リンクチェッカーは kknews について実カバレッジを持たず、生成されるのは偽陽性ノイズのみだった。

姉妹サイト edu-evidence は、同じ「ボットをブロックする出版社・学会サイトによる偽陽性」に先行して直面しており、その link-check ワークフローでは既に複数ドメイン（`doi.org/10.1037`、`doi.org/10.5951`、`educationendowmentfoundation.org.uk`、`nctm.org`、`us.corwin.com`、`chikumashobo.co.jp`）を `--exclude` で除外している。本決定はその確立済みパターンを edu-watch のニュース系ソース（kknews）へ適用するもので、両リポジトリの運用方針として一貫する。

## 検討した選択肢

- **A) 毎回手動でクローズし続ける**（現状）。週次で再発し、本物のリンク切れを埋もれさせるノイズになる。
- **B) `--timeout` / `--max-retries` を増やす**。応答自体が返らないため無効。
- **C) ブラウザ User-Agent を付与する**。デフォルト UA でも 200 が返ることから、ブロックは UA ベースではなく IP ベースで、無効。
- **D) lychee から `kknews.co.jp` を除外する**（`--exclude`）。edu-evidence と同じ確立済みパターン。

## 決定

D を採用する。`link-check.yml` の lychee args に `--exclude 'kknews\.co\.jp'` を追加する。

## 影響

- CI から kknews の「本物のリンク切れ」を自動検知できなくなる。ただし元々 CI は kknews へ到達できず（全タイムアウト）実カバレッジはゼロだったため、検知能力の損失はない。
- 他ドメインのリンクチェックは従来どおり機能し、kknews 以外の実リンク切れは引き続き検知される。
- kknews がクラウド IP のブロックを解除した場合は、本除外を撤回して再評価する。
- 将来、別のボットブロック系ドメインで同じ偽陽性が出た場合は、edu-evidence と同様に `--exclude` を追記して対応する。
- kknews リンクの健全性を確認したい場合は、通常 IP の環境からローカルで一括確認できる:

  ```bash
  npm run build
  grep -rhoE 'https?://www\.kknews\.co\.jp/[^"<> ]+' dist | sort -u \
    | xargs -P 8 -I{} sh -c 'echo "$(curl -sS -o /dev/null -L --max-time 30 -w "%{http_code}" "{}") {}"' \
    | grep -v '^200 ' || echo "all live"
  ```
