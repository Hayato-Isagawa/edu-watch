# 0016. 直線 3px アクセントバーは角張ったリスト要素のみに適用する

- 状態: 採用
- 日付: 2026-04-29
- 関連 PR: #54(初回マージ、ADR 番号 0015 で発行)、#XX(ADR 0015 重複により 0016 へリネーム)
- 注記: 本 ADR は当初 0015 として PR #54 でマージされたが、先行マージの PR #53(ADR 0015: mext-education-scope-filter)と番号衝突したため 0016 にリネームした。内容は変更なし。

## 背景

姉妹サイト EduEvidence JP で、リンク要素のホバー表現に主に 2 系統の語彙があることが整理された:

- **左 3px 緑アクセントバー**(`scaleY` で上から下へ伸びる装飾)
- **border 全周 + タイトル色 + 背景反転**

EduEvidence では同じ判断を 3 PR(#125 / #127 / #129)で繰り返した結果、「直線バーは角張ったリスト要素のみに適用する」という規約が ADR 0008 として確定した。EduWatch JP は今後 Sprint 3 でフロントエンドを本格実装する段階にあり、`ArticleCard.astro`(`border-t` 矩形)と将来的な rounded カードの両方を扱う見通しがある。視覚言語を 4 サイトブランド体系(ADR 0001 関連)で揃えるため、本リポジトリでも同じ規約を採択する。

## 検討した選択肢

### A) 規約を持たない(コンポーネント単位で随時判断)

- 利点: 個別最適化の自由度
- 欠点: EduEvidence で発生したのと同じ「導入 → 削除」の反復が起きる

### B) EduEvidence ADR 0008 と同じ規約を採用する(採用)

- 利点:
  - 4 サイトブランド体系のもとで、姉妹サイトと視覚言語が一致する
  - コンポーネント設計の迷いがなくなる
  - EduEvidence の運用実績(PR #125 / #127 / #129)を活用できる
- 欠点: ローカル文脈で例外が生じる可能性がある(その場合は本 ADR を撤回 / 別 ADR で上書き)

## 決定

直線 3px アクセントバーは **角張ったリスト要素にのみ** 適用する。

### 適用してよい(角張ったリスト要素)

- `border-t` / `border-b` だけで境界を引く水平リスト
- 現状該当: `ArticleCard.astro`(記事一覧の項目、`border-t` 矩形)
- 将来追加されるリスト型 UI(週次サマリの記事リストなど)

### 適用しない(角丸カード)

- `rounded-xl` / `rounded-lg` などで囲まれたカード
- 現状該当: `LatestDigestBlock.astro` のラッパー、トップページの hero カード周辺

### 角丸カードで使う hover 語彙(EduEvidence と統一)

- `hover:border-[var(--color-accent)]` — 全周 border を緑に
- `group-hover:text-[var(--color-accent)]` — 主要見出し(h2 / h3)を緑に
- 必要に応じて `hover:bg-[var(--color-card)]` — 背景反転
- transition は `motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out`
- 将来 `--color-accent-hover` トークンを採択する場合は EduEvidence と整合させる

## 影響

- Sprint 3 以降の UI 実装で本 ADR を参照
- `ArticleCard.astro` は現状 hover 表現未実装。今後 hover を追加する際は本 ADR に沿う
- LatestDigestBlock など rounded カード系コンポーネントには直線バーを使わない

## 関連

- ADR 0011: UI 状態はセマンティック属性で管理する
- EduEvidence ADR 0008: linear-accent-bar-scope(本 ADR の起点)
- EduEvidence の運用実績: PR #125(ピックアップカードで導入後に削除)、PR #127(`/concerns` カードでは最初から不採用)、PR #129(`RelatedStrategyCard` で再導入してまた削除)
