## 要約対象

- slug:
- section:
- pdfUrl:
- 発行(issuer):
- 発行日(issueDate):
- 生成物: `tmp/ai-summary/<slug>/<section>/summary.md`

## fact-check 結果

`tmp/ai-summary/<slug>/<section>/fact-check-report.json` の数値:

- facts 件数:
- 初期 present:
- retry 救出:
- still-missing:
- 最終救出率:

## 編集者監修(ADR 0040 §C-6)

原文 PDF と突合する 3 点:

- [ ] 核心数値の原文突合(summary.md の数値が PDF 原文と一致)
- [ ] 出典ページの原文突合(summary.md `(p.NN)` が PDF 原文位置と一致)
- [ ] 幻覚有無(PDF 原文に存在しない記述が summary.md に混入していないこと)

## 初回 3 件監修(教育長レベル)

ADR 0040 §C-6 の運用安定化フェーズに該当する場合:

- [ ] 監修担当:
- [ ] 監修コメント:

## Test plan

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] サイト反映の目視確認(該当する場合)
