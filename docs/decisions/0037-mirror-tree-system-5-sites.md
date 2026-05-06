# ADR 0037: 木の部位体系 5 サイト拡張を edu-watch にミラーする

## Status

採択 (2026-05-06)

## Context

`docs/BRAND.md` は edu-evidence と edu-watch の 2 リポジトリに同一内容で配置する運用。原本側(edu-evidence)で ADR 0020 が採択され、4 サイト体系から 5 サイト体系へ拡張された(`Hayato-Isagawa/edu-evidence` PR #168、commit `d206ea0`)。

主な変更点:

1. **EduLaw JP**(`law.edu-evidence.org`)を **根(root)** として正式採択
2. **EduResearch JP**(`research.edu-evidence.org`)を **種(seed)** として新規追加
3. 種の意味を「次世代教員養成・採用支援」から「研究アイデア源」へ再定義
4. アクセント色の方向性: 根 `#6b4423`(茶)、種 黄土色 / 麦色系
5. 対称性方針: 根は左右対称、種はロゴ実装時に決定
6. 同期ターゲットに EduLaw JP / EduResearch JP リポジトリを追加

edu-watch はこのブランド体系の中で **双葉(cotyledon)** を担当しており、5 サイト体系移行後も双葉の位置付け・色 `#1e4a6e` ・wordmark ・対称性方針に変更はない。ただし BRAND.md の同一性を保つため、edu-watch 側でも同内容のミラー PR が必要となる。

## Decision

`docs/BRAND.md` を edu-evidence の最新版(`d206ea0` 時点)と完全同一内容に置き換える。

### 変更範囲

- `docs/BRAND.md`: 全面置換(4 サイト体系記述を 5 サイト体系記述に置換)
- `docs/decisions/0037-mirror-tree-system-5-sites.md`(本 ADR): 新規作成

### 変更しないもの

- edu-watch 側のコード(`src/components/Logo.astro` / `src/styles/global.css` / Layout など)
- 双葉モチーフのアクセント色 `#1e4a6e`
- 双葉の左右非対称方針
- wordmark `EduWatch <accent>JP</accent>` パターン

5 サイト体系への移行は文書レベルのブランド体系拡張であり、edu-watch の既存実装には影響しない。

### 原本との同期方針

- 原本: `Hayato-Isagawa/edu-evidence` の `docs/BRAND.md`(ADR 0020 が原典)
- ミラー: 本リポジトリの `docs/BRAND.md`(本 ADR がミラー記録)
- 今後 BRAND.md の変更は edu-evidence 側で先行 PR を出し、その後 edu-watch 側で同期 PR を作成する手順を維持する

## Consequences

### 利点

- 5 サイト体系に関する一次情報(根・種の追加、種の意味再定義)が edu-watch 内のドキュメントからも参照可能になる
- 将来 edu-watch を新規に触る貢献者が、姉妹サイト全体の生態系を BRAND.md だけで把握できる
- edu-evidence ・ edu-watch 間で BRAND.md の文言不一致が解消される

### コスト

- 本 PR は文書のみの変更でビルド・E2E テスト・型チェックに影響しないが、CI は通常通り回す

### 影響範囲

- edu-watch のコード・スタイル・コンテンツ・公開挙動: 変更なし
- 既存 ADR: 変更なし(既存 ADR 0036 までは現状維持、本 ADR は 0037 として追加)
- 将来 EduLaw JP / EduResearch JP リポジトリでも、立ち上げ時に同一内容の BRAND.md と対応 ADR を配置する

## References

- `docs/BRAND.md`(本 PR で更新)
- `Hayato-Isagawa/edu-evidence` ADR 0020(原典): `docs/decisions/0020-tree-system-expansion-edu-law-edu-research.md`
- `Hayato-Isagawa/edu-evidence` PR #168: `docs(brand): expand tree system to 5 sites — adopt edu-law (root) and edu-research (seed)`(2026-05-06 マージ済み、commit `d206ea0`)
