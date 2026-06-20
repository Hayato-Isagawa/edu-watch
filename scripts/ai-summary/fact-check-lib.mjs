// 純粋・決定的なファクトチェックロジック（fs / network 副作用なし）。
// fact-check-grep.mjs（本番パイプライン）と gate.test.mjs（LLM 非依存テスト）の双方から import される。

export function grepFacts(text, facts) {
  const norm = text.normalize('NFKC');
  return facts.map((f) => ({
    ...f,
    found: f.patterns.some((re) => re.test(norm)),
  }));
}

export function squeezeJpSpaces(s) {
  let prev;
  let cur = s;
  const re = /([぀-ヿ㐀-鿿0-9,])\s+([぀-ヿ㐀-鿿0-9,])/g;
  do {
    prev = cur;
    cur = cur.replace(re, '$1$2');
  } while (cur !== prev);
  return cur;
}

export function judgeStrict(facts, summaryText, chunkSources) {
  const normSummary = summaryText.normalize('NFKC');
  const details = facts.map((f) => {
    const summaryHit = f.patterns.some((re) => re.test(normSummary));
    const chunkNumbers = f.sourceChunks || [];
    let rawChunkText = '';
    for (const n of chunkNumbers) {
      if (chunkSources[n]) rawChunkText += '\n' + chunkSources[n];
    }
    const normChunk = squeezeJpSpaces(rawChunkText.normalize('NFKC'));
    const rawChunkHit = rawChunkText ? f.patterns.some((re) => re.test(normChunk)) : false;
    let judgment;
    if (summaryHit && rawChunkHit) judgment = 'present';
    else if (summaryHit && !rawChunkHit) judgment = 'llm_hallucination';
    else if (!summaryHit && rawChunkHit) judgment = 'llm_dropped';
    else judgment = 'missing';
    return {
      id: f.id,
      severity: f.severity,
      summaryHit,
      rawChunkHit,
      judgment,
    };
  });
  return {
    totalFacts: facts.length,
    strictPresent: details.filter((d) => d.judgment === 'present').length,
    llmHallucinated: details.filter((d) => d.judgment === 'llm_hallucination').length,
    llmDropped: details.filter((d) => d.judgment === 'llm_dropped').length,
    stillMissingStrict: details.filter((d) => d.judgment === 'missing').length,
    details,
  };
}

export function summarizeFact(f) {
  return { id: f.id, severity: f.severity, description: f.description };
}

// canonical summary.md への grep 結果（present / missing）から公開可否ゲートを算出する。
// HIGH 必須 fact の欠落が 1 件でもあれば BLOCK、HIGH は揃うが他 severity が欠ければ WARN、全充足で PASS。
export function computeGate(present, missing, totalFacts) {
  const missingHigh = missing.filter((f) => f.severity === 'HIGH');
  const missingMedium = missing.filter((f) => f.severity !== 'HIGH');
  const status = missingHigh.length > 0 ? 'BLOCK' : (missing.length > 0 ? 'WARN' : 'PASS');
  return {
    status,
    canonicalPresent: present.length,
    total: totalFacts,
    missingHigh: missingHigh.map(summarizeFact),
    missingMedium: missingMedium.map(summarizeFact),
  };
}

// retry プロンプト。循環回収（fact description の数値をそのまま渡しモデルがコピーするだけで「回収」判定される問題、
// ADR 0046 §撤回条件 / ADR 0057）を遮断するため、不足リストには数値を含まない retryHint のみを渡す。
// retryHint 欠落時のフォールバックもリスト序数のみで、答案数値・id（数値を含む）を一切漏らさない。
export function buildRetryPrompt(summary, missingFacts, chunkSources) {
  const missingList = missingFacts.map((f, i) => `${i + 1}. ${f.retryHint || `必須データ点 ${i + 1}`}`).join('\n');
  const chunkExcerpts = Object.entries(chunkSources)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([n, text]) => `## chunk-${n} (raw)\n\n${text}`)
    .join('\n\n---\n\n');

  return `あなたは中央教育審議会答申の要約編集者です。以下の要約には核心数値が脱落しています。chunk 抜粋メモから不足数値を保持しながら、要約全体を再生成してください。

# 不足している必須データ点

${missingList}

# 制約

- 元の 4 セクション構造(「1. 何が決まったか」「2. いつから実施されるか」「3. 現場で必要な対応」「4. 参照すべき PDF ページ」)を維持
- 不足データ点は本文中に必ず組み込み、出典ページを (p.X) 形式で併記
- 圧縮しないでください(出力長は元の要約と同等以上)
- chunk 抜粋メモにない内容、推測、一般論は書かない
- 数値・固有名詞・時期は原文と一致させてください

# 元の要約

${summary}

# 該当 chunk 抜粋メモ

${chunkExcerpts}`;
}
