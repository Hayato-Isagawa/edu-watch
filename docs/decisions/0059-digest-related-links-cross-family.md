# 0059. ダイジェストの関連リンクを姉妹サイト横断(evi + law)へ拡張する

- 状態: 採用
- 日付: 2026-06-23
- 関連 PR: feat/digest-law-links
- 関連: 4 サイト横断リピート訪問性分析(2026-06)P2 #6 / ADR 0047(ダイジェストのセクション構造)

## 背景

週次ダイジェストは末尾に関連リンク節を持ち、`relatedEvidenceUrls`(`src/content.config.ts`)で姉妹サイトのページを列挙している。だが描画(`src/pages/digest/[slug].astro`)は見出しを「関連エビデンス(姉妹サイト EduEvidence JP)」と **evi 固定でハードコード**していた。

4 サイト横断リピート訪問性分析(2026-06)の P2 #6 は、ニュースの背景に法令・公的方針がある回で、読者を姉妹サイト EduLaw JP(law.edu-evidence.org)の法令解説ガイドへ送る導線を求めた。スキーマ `relatedEvidenceUrls: z.array(z.string().url())` は任意の URL を通すが、描画が evi 固定ラベルのため law URL を入れると誤ラベルになる(技術的障壁を実機調査で特定)。

## 決定

1. `relatedEvidenceUrls` の意味を「姉妹サイト横断(evi + law)の関連リンク」へ拡張する。
2. 描画を host ベースの site-aware ラベルにする: `law.edu-evidence.org` → 「EduLaw JP」/ `edu-evidence.org`(`www.` 含む)→ 「EduEvidence JP」/ それ以外 → ラベル無し。見出しは「関連リンク(姉妹サイト)」へ汎用化する。
3. フィールド名 `relatedEvidenceUrls` は据え置く。

## なぜこの判断にしたか

- 単一フィールド + ラベル判定は、別フィールド(`relatedLawUrls`)追加による 2 セクション重複より最小で DRY。
- 後方互換: 既存 6 本(全 evi URL)は同じ「EduEvidence JP」ラベルで従来通り描画され、構造は不変。
- フィールド名据え置きは、改名が digest 6 本 + schema + 描画へ波及するため(最小変更原則)。名称は evidence 由来だが、意味は本 ADR で「姉妹サイト横断の関連リンク」と定義し直す。
- host 判定は `new URL().hostname` を try/catch で安全に解析し、不正 URL はラベル無しにフォールバックする(入力境界のバリデーション)。

## 帰結

- 2026-06-20 のダイジェスト(働き方改革を扱う回)に `https://law.edu-evidence.org/guides/work-style-reform/` を追加し、導線を 1 本通した(リンク先は HTTP 200 で live 確認済)。
- 今後、法令・公的方針が背景にある回は law ガイド URL を関連リンクに加えられる。
- ユーザー向け変化のため changelog に 1 行追加(rule: PR ごとに changelog 更新)。

## トレードオフ / 既知のリスク

- フィールド名 `relatedEvidenceUrls` は law を含む実態と名がずれる。改名コストを避けるため許容し、本 ADR で意味を明示する。
- 関連リンクは生 URL 表示のまま(跨サイトのページタイトル取得は build 時に不可)。表示の改善は別タスク。

## 撤回 / 再検討の条件

- 関連リンクの種類が増えて単一フィールド + ホスト判定が煩雑になる場合、サイト別フィールドまたは構造化(`{ url, site }`)へ再設計する。
