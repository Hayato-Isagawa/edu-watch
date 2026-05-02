# 0021. nikkyo paywall 判別マーカーの OR 化と表現の正確化

- 状態: 採用
- 日付: 2026-05-02
- 関連 ADR: 0013(日本教育新聞の会員限定記事を判別し、UI 上で予告する)
- 関連 PR: TBD(本 ADR の実装)

## 背景

ADR 0013(2026-04-28)で日本教育新聞 paywall を「`<article>` テキスト内に『会員登録』+『ログインして』が共起」の AND 判定で検出することにした。サンプル 10 件で 100% 分離を確認していた。

2026-05-02 セッションで article JSON を点検したところ、**直近 nikkyo 30 件すべて `requiresMembership=undefined`** であることが判明。違和感を抱き、当該 30 URL を直接フェッチして再判定すると **15 件(50%)が現時点で paywall 化されている** ことを実測:

| URL | ADR 0013 判定 | 取り込み時 JSON | 現時点判定 |
|---|---|---|---|
| 直近 30 URL のうち 15 件 | true | undefined | **true** |
| 残り 15 件 | false | undefined | false |

加えて 4 マーカー(ADR 0013 のキーワード共起・lock アイコン `fas fa-lock`・lock 専用ボタンクラス `locked-article-login-button`・確定文言「日本教育新聞電子版に会員登録する必要」)が **15/15 で完全一致**(揃って true / 揃って false の二択)。マーカーの有意性は変わっていない。

ADR 0013 採用後の実態として 2 つの問題が見えた:

1. **公開後 paywall 化**: 公開直後は無料、後日 paywall 化される運用が日教側にある(直近 30 件で 50% 該当)。cron 実行時の判別タイミングでは paywall マーカーがなく、後から paywall 化されても再判定されないため article JSON 上は永遠に無料扱い
2. **マーカー単一依存のリスク**: テンプレート変更で「会員登録」「ログインして」のいずれかが他の文言に変わるだけで、ADR 0013 の AND 判定は完全に死ぬ。実際の HTML には他にも 3 つの paywall マーカーがあり、これらを併用すれば耐性を上げられる

また ADR 0013 §決定では「会員登録(無料 or 有料)」と表現していたが、本セッションで実際に日教 HTML を観察した結果、**「無料会員」「有料会員」を区別する文言は HTML 上に一切存在しない**(プレミアム / サポーター / 購読 / 無料会員 / 有料会員 などすべて出現ゼロ)。日教電子版は単一の有料プラン(月額制)で運用されており、「会員登録(無料 or 有料)」という ADR 0013 の表現は不正確で、読者に「無料会員でも見られるかも」という誤認を与えかねない。

## 検討した選択肢

### A. マーカー OR 化 + 文言の正確化(本 ADR スコープ、採用)

メリット:
- 4 マーカーいずれか 1 つで true 判定する OR ロジックは、テンプレ変更で 1 マーカーが消えても残り 3 つで耐性を持つ
- 無料/有料の不確実な区別を排し、「電子版会員(有料)」という最も保守的・正確な表現に統一
- 実装は `nikkyo.ts` の判別関数 + UI 文言 3 箇所の置換のみで済み、リスクは低い
- 純粋関数 `detectMembershipFromArticleScope()` を分離して `npm run check:membership:nikkyo` で smoke test 可能に

デメリット / 緩和策:
- 「公開後 paywall 化への追従」は本 ADR では解決しない → 別 ADR(0022 案)で `recheck-membership.ts` を独立に設計する
- OR 化で false positive が増えるリスク → 4 マーカーは実測で完全一致する強相関なので、現時点で false positive が出るシナリオは想定されない

### B. 公開後 paywall 化への追従(再判定 cron)を本 ADR で実装(却下)

却下理由:
- スコープが大きい(article JSON の上書きルール変更、ADR 0010 §「mergeDay は既存 id を上書きしない」との整合再検討、再判定の頻度 / コスト判断)
- ADR 0013 §影響「既存記事には適用されない」を覆す方針判断は独立 ADR で扱うべき
- 本 PR で OR 化と文言修正を先に出し、再判定設計は別 PR で時間をかけて検討する方が安全

### C. 「無料会員 / 有料会員」の細分化(却下、技術的に不可能)

却下理由:
- HTML 上に区別マーカーが存在しない(実測でゼロ)
- 日教電子版は単一プラン運用と推測される(プレミアム / サポーター / フリー会員などの併存マーカーがない)
- 細分化のための情報源がないため実装不可

## 決定

A を採用。

### (1) `detectMembershipFromArticleScope()` を 4 マーカー OR 化

```ts
export function detectMembershipFromArticleScope(scope: string): boolean {
  if (scope.includes("locked-article-login-button")) return true;
  if (scope.includes("fas fa-lock")) return true;
  if (scope.includes("日本教育新聞電子版に会員登録する必要")) return true;
  if (scope.includes("会員登録") && scope.includes("ログインして")) return true;
  return false;
}
```

テスト容易性のために fetch から純粋関数を分離。`detectMembershipRequired(url)` 側は変わらず HTML 取得と AbortController による 8s タイムアウトを担う。

### (2) UI 文言の正確化

| 場所 | 旧 | 新 |
|---|---|---|
| `ArticleCard.astro` バッジ | 会員限定 | 電子版会員のみ |
| `ArticleCard.astro` tooltip | この記事は媒体サイトでの会員登録(無料 or 有料)が必要です | この記事は媒体サイトの電子版会員(有料)登録が必要です |
| `SourcesIntro.astro` 注記 | 会員登録(無料 or 有料)が必要 / バッジ「会員限定」 | 電子版会員(有料)登録が必要 / バッジ「電子版会員のみ」 |
| `about.astro` 注記 | 同上 | 同上 |

`changelog.astro` の過去エントリ(2026-04-28 の「日本教育新聞の会員限定記事を一覧上で予告表示」)は **改ざんしない**。当時の事実を反映した不変記録として残す。

### (3) `npm run check:membership:nikkyo` で smoke test

`scripts/check-nikkyo-membership.ts` で 8 ケース(true 5 / false 3)を assert。

- **true**: 各マーカー単独 / 全マーカー揃い / ADR 0013 キーワード共起
- **false**: マーカーゼロ / 「会員登録」単独 / 「ログインして」単独(AND 要件回帰防止)

## 影響と運用

### 既存記事は変わらない

ADR 0013 §影響「既存記事には適用されない」を本 ADR でも維持。本 ADR 後の取り込みからのみ新ロジックが適用される。

### 「公開後 paywall 化」の未解決問題

直近 30 件で 50% 該当することが判明したため、別 ADR(0022 案)で再判定 cron / 過去記事の更新ルールを独立検討する。本 ADR 採用直後は引き続き「取り込み時点で無料 → 後日 paywall 化された記事」は `requiresMembership=undefined` のまま残る。

### 4 マーカー観測の保守

- 四半期に 1 度 `npm run check:membership:nikkyo` の実 URL バリエーションを増やす(8 ケース → 12 ケース程度)
- 日教側で全マーカーが消えるテンプレ変更があった場合、`<article>` 領域の文字数分布や `class="paywall"` 等の新マーカーで再構築

## 撤回 / 再検討の条件

- 日教が paywall を class マーカー(`paywall`, `member-only` 等)や RSS フィールドで明示するように変更した場合 → そのマーカーを 1 つ目に追加(優先順位 1 位)
- 4 マーカー全てが false positive を生み出すテンプレ変更がサイト全体で起きた場合 → スコープ判定(`<article>` 領域の限定)を強化、または除外
- 別媒体(kkn / kyodo など)で同じ問題が判明した場合 → `src/lib/membership.ts` 共通判別器に再構成(ADR 0013 §撤回 / 再検討の条件と同じ)

## 残タスク(別 ADR / PR)

- **ADR 0022 案**: 公開後 paywall 化への追従(過去 N 日の nikkyo 記事を再判定する cron)。article JSON の `requiresMembership` を上書き可能にするため ADR 0010 §「mergeDay は既存 id を上書きしない」との整合を再検討する必要あり
- 「電子版会員(有料)」の正確性を継続観測(日教が無料会員枠を新設した場合は表現を再調整)
