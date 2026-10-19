# 0078. 0.x の本番依存の minor 更新を自動マージから外し、OG の描画を E2E で検査する

- 状態: 採用(0041 の「patch / minor は自動マージ」を、0.x の本番依存の minor 更新について上書き)
- 日付: 2026-10-19
- 関連 PR: `ci/og-render-guard`(本 ADR 起票)
- 関連 ADR: [`ADR 0041`](0041-dependabot-auto-merge-policy.md)(自動マージの方針) / [`ADR 0067`](0067-og-cache-version-source.md)(OG のキャッシュ版数) / [`ADR 0068`](0068-content-neutral-vrt-baseline-and-exact-threshold.md)(VRT のベースライン)
- 関連 issue: #885

## 背景

satori 0.42.0 で `boxSizing` の既定が `border-box` から `content-box` に変わり(vercel/satori#855、リリースノートには未記載)、ダイジェストの OG 画像が全号で崩れた。title が右端で切れ、下端のチップと URL が画像の外に出た。修正は #884。

この更新は #867(0.33.5 → 0.56.1)で main に入った。Dependabot はこれを semver-minor と判定し、`dependabot-auto-merge.yml` は major 以外を自動マージする(ADR 0041)。崩れに気づいたのは 2 日後のダイジェストの表示確認ゲートだった。

止める仕組みが無かった:

- OG の PNG を見る検査が無い。ビルドは通り、PNG も出る。
- VRT は OG を撮っておらず、required check でもない。自動マージは required check しか待たない。

## 決定

### D1. OG の描画を E2E で検査する

`e2e/og-image.spec.ts` が、配信される全号の `/og/digest/<slug>.png` を画素で確かめる。E2E(「Playwright E2E」)は required check なので、依存更新の自動マージもここで止まる。

- 1200×630 で、背景色と違う画素が padding の内側を 20px 広げた箱の外に無い。許容を置くのは、行頭の A / V / Y / j の字形が padding の外へ数 px はみ出すため。崩れたときの字は x≥1162 に出た。
- 下端の行の、チップの右端(x=920)より右に URL がある。左にチップ(アクセント色)がある。topics は全号で必須(`content.config.ts` の `min(1)`)なので条件にしない。
- ダイジェストが 0 件なら失敗する。

### D2. 0.x の本番依存の minor 更新は人が見る

`dependabot-auto-merge.yml` は、次のどれかに当たる PR を自動マージせず、理由を PR にコメントする。

- major 更新(ADR 0041 のまま)
- update-type を判定できなかった更新
- 本番依存(`dependencyType` が `direct:development` / `indirect` 以外)のうち、0.x から minor 以上が変わるもの、またはバージョンを読めないもの

0.x では minor が破壊的変更を含みうる(npm のキャレット `^0.33.5` も `0.34` を許さない)。#867 はこの形だった。

判定は fetch-metadata の `updated-dependencies-json` で行う。`previous-version` / `new-version` の出力は先頭の依存 1 件分しか持たず、グループ化された PR の 2 件目以降が見えない。判定ステップは `scripts/__tests__/dependabot-auto-merge-workflow.test.mjs`(`test:workflows`)が固定している。

### D3. OG を VRT の対象には足さない

VRT は required check ではないので、自動マージを止められない。D1 が同じ崩れを required 側で止める。`vrt/targets.mjs` は `src/pages/` の `.astro` と 1 対 1 で、`.ts` のエンドポイントは設計上対象外。PNG をブラウザで 4 断面に撮ると、画像表示の背景や縮小が差分に混ざる。

## 範囲

- 対象は本番依存。2026-10-19 時点で 0.x の本番依存は `satori` と `sharp`。github-actions の依存も `direct:production` に入る(同時点で 0.x の action は無い)。
- 開発依存の 0.x(`oxfmt` / `@astrojs/check`)は対象外。壊れれば `format:check` や型検査が required check で落ちる。
- 推移依存(`indirect`)の 0.x も対象外。OG を描く経路の崩れなら D1 が受け止める。
- patch 更新は 0.x でも自動マージする。

## 帰結

- satori と sharp の minor 更新は手でマージする。2026-07-19〜10-19 の satori の minor は 5 本だった。
- 保留した PR は開いたまま残り、Dependabot の `open-pull-requests-limit`(npm は 5)に数えられる。溜めると新しい更新の PR が開かなくなる。
- Dependabot の PR は `ci-summary.yml` の完了通知の対象外なので、保留に気づく経路は D2 のコメント(GitHub の通知)になる。
- D1 は og-image.ts の数値をテストに直接書いている。枠を縮める変更をすると赤になるので、合わせて直す。

## 撤回 / 再検討の条件

- satori が 1.0 に達し、semver に沿って major で破壊的変更を出すようになったら、D2 の対象から自然に外れる(0.x の判定に当たらなくなる)。
- 保留した PR が溜まって `open-pull-requests-limit` に当たるようなら、対象の絞り込みか上限の見直しを検討する。
