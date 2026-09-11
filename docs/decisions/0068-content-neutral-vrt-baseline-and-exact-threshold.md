# 0068. VRT のベースラインを「main のコード × PR のコンテンツ」で撮り、判定を `threshold: 0` にする

- 状態: 採用
- 日付: 2026-09-11
- 関連 PR: `ci/vrt-content-neutral-baseline`
- 関連 ADR: [`ADR 0060`](0060-visual-regression-testing.md)(VRT の導入) / edu-evidence ADR 0034(コンテンツ中立ベースライン・原本) / edu-evidence ADR 0035(依存 bump で VRT を起動) / edu-evidence ADR 0036(`threshold: 0`。edu-evidence PR #570 で採用) / edu-law の `playwright.vrt.config.ts`(閾値の実測)

## 背景

ADR 0060 は記事・ダイジェストの更新が毎回テキスト差分を生むため、VRT を `paths` で限定起動する設計にした。
ところが `src/data/**` を `paths` に入れていた間は、自動収集で一覧が伸びるたびにページの高さが変わり
毎回 4/24 が落ちていた(`vrt.yml` のコメント。2026-08-08 に desktop 9601→9755px)。`paths` から外して
収集 PR では起動しなくなったが、**`src/pages` を触る PR が main との間に収集を挟むと、同じ差分が
そのまま赤として出る**。赤の実体は視覚回帰ではなくコンテンツの増加で、`paths` では止められない。

edu-evidence は同じ問題を ADR 0034 で「ベースラインを main のコード × PR のコンテンツで撮る」形に
変え、過去 PR の再現で 5 赤 → 1 赤(残った 1 赤はテンプレートを触った本物)を実測している。

判定の側にも穴が 2 つある(edu-law が実測で確立):

- **長さ**: `maxDiffPixelRatio` の許容量は総ピクセル数 × 比率なので、長いページほど甘い(edu-law では
  0.001 の許容が短いページと長いページで約 15 倍開いた)
- **色**: Playwright が pixelmatch に渡す `threshold`(既定 0.2)未満の色差は数えられないので、比率を
  下げても色だけの変更は捕まらない

## 決定

3 つをまとめて edu-evidence に揃える。

1. **ベースラインを「main のコード × PR のコンテンツ」で撮る。** `Build baseline (main code x PR content)`
   ステップが main の worktree に PR の `src/content/` と `src/data/` を `rsync -a --delete` で、
   `src/content.config.ts` を `cp` で運んでからビルドする。main のコードで PR のコンテンツを
   ビルドできなければ、main 自身のコンテンツで撮り直す(degraded。summary と artifact 名に出す)。
   `workflow_dispatch` の `neutral: false` で素の main と撮り比べる逃がしも持つ
2. **判定を `threshold: 0` + `maxDiffPixels: 0` にする。** `maxDiffPixelRatio` はやめる
3. **`package-lock.json` を `paths` に足す。** 依存 bump でも VRT を起動する。ただし auto-merge は
   required しか待たないので、非 major の bump では事後の記録にしかならない

`src/data/` を運ぶ根拠は、中身が「どの記事が載るか」を決めるコンテンツで描画のコードではないこと
(`vrt.yml` のコメント)。`og-version.ts` が変えるのは `<head>` の meta だけでピクセルに出ない。

### 運ぶ素材の allowlist とガード

運ぶのは `src/content/` / `src/data/` / `src/content.config.ts` だけ。`package*.json`(依存の視覚影響は
VRT が見るべきもの)と `public/`(ブランド資産と配信設定)は運ばない。allowlist は手書きなので、
`scripts/__tests__/vrt-baseline.test.mjs` が `src/` の実ディレクトリを走査し、「運ぶ・`paths` で監視する・
描画に入らないと明言する」の三択を強制する。運ぶディレクトリが `paths` に残っていれば赤(起動はするが
差分が出ないトリガになるため)。位置(運ぶのがビルドより前)・`--delete`・`id: baseline`・degraded の
失敗許容がビルド 1 つに閉じていること・artifact 名、も固定している。

### ノイズ測定(2026-09-11)

`threshold: 0` は撮影の安定化ループの収束条件でもあるので、CI で測ってから置く。この PR は描画を
変えないので、PR 自身の VRT run が「同一 dist の撮り比べ」になる。

`workflow_dispatch` で本ブランチの VRT を 3 回まわした(run 34583178723 / 34583566456 / 34583957327)。
3 回とも `MODE: neutral`、ベースラインの `origin/main` は `be807ee` で不変、撮影 24 / 比較 24 が全通過、
"Failed to take two consecutive stable screenshots" は 0 件。手元(macOS)でも同一 `dist` の撮り比べで 24 / 24。
(姉妹リポでは完全一致が通らなかった例がある — okinawa-in-data の点線下線、portfolio の丸ボタンの円周 —
が、このリポにはその要素が無い。)

## 帰結

### 利点

- 収集で一覧が伸びただけの赤が構造的に消える
- テンプレート・共有コンポーネント・`global.css` の回帰は残る(edu-evidence の実測では同一集合)
- 色だけの変更・長いページの小さな差分が捕まる

### コスト・受け入れた死角

- degraded ではベースラインを 2 回ビルドする
- `.astro` に直接書かれた散文(`changelog.astro` の `entries` など)は中立化されない
- コンテンツ起因のレイアウト崩れ(長い見出しの折り返し等)は両側に同じ文字列が入るので見えない。
  `neutral: false` の手動実行が逃がし
- `threshold: 0` はバイト完全一致ではない。pixelmatch の `includeAA` でアンチエイリアスと判定された
  画素は数えない

### ADR 0060 の訂正

ADR は不変とする運用のため 0060 は書き換えず、本 ADR で訂正する。

| 箇所 | 訂正 |
|---|---|
| 「`maxDiffPixelRatio 0.01`」 | 導入後に 0.001 へ下げ(`CLAUDE.md` に経緯)、本 ADR で比率をやめた |
| 「計 13」「changelog」を含む対象列挙 | `/changelog` は対象外にしており、実件数は 12 |
| ゲートの `paths` 列挙 | その後 `src/pages/**`・`src/lib/**` が追加され、本 ADR で `package-lock.json` が追加された。`src/data/**` は運ぶ素材なので載せない |
| 「`src/data/**`・`src/content/**` だけの PR では起動しない」 | 変わらない。ただし他の PR に波及する差分は本 ADR で相殺される |

## 撤回 / 再検討の条件

- CI で収束失敗("Failed to take two consecutive stable screenshots")が繰り返し出るなら、
  `maxDiffPixels` をノイズの実測値に置き直す(比率には戻さない)
- degraded が常態化するなら、運ぶ素材の形(`src/data` の中のロジック)を見直す
