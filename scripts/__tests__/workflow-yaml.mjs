// ワークフローのテストが YAML をパースして見るときの共通部分(#919 / #920)。
// `*.test.mjs` ではないので、node --test の対象にはならない。

import assert from "node:assert/strict";
import YAML from "yaml";

/**
 * ワークフローを読む(`merge: false`)。
 *
 * GitHub Actions はマージキーを展開しない(actions/runner#1182 で runner の COLLABORATOR が
 * 「Merge keys are part of YAML 1.1 but not YAML 1.2」と回答)。`merge: true` で読むと
 * `<<: {id: lychee, continue-on-error: true}` のように GitHub では効かない値が「ある」と
 * 見えて、「あること」を求める規則が緩む。ただし `!!merge <<:` と、`%YAML 1.1` の下の
 * `<<:` は `merge: false` でも yaml が展開する。なので規則の側は `mergeKeyPaths` を必ず併用し、
 * マージキーを使っていること自体を違反にする。
 */
export const parseWorkflow = (src) => YAML.parse(src, { merge: false });

// yaml 自身の判定(schema/yaml-1.1/merge.js の identify)が展開する形を含めて拾う。展開される
// 形ではキーの値が Symbol("<<") になる。引用符付きの "<<" も拾うので、yaml より広い
const isMergeKey = (key) =>
  YAML.isScalar(key) &&
  (key.value === "<<" ||
    (typeof key.value === "symbol" && key.value.description === "<<") ||
    key.tag === "tag:yaml.org,2002:merge");

/**
 * マージキーを使っている位置を返す(例: `jobs.notify`)。
 * 展開された後の値では `!!merge` や `%YAML 1.1` の形が見えないので、文書の木で探す。
 * キーをエイリアスで書いた形(`&k <<` を置いて `*k :`)も、参照先を解決して拾う。
 * yaml はこの形を展開しないが、値が `<<` の下に隠れて「無いこと」を求める検査が素通りする。
 */
export function mergeKeyPaths(src) {
  const doc = YAML.parseDocument(src, { merge: false });
  const found = [];
  YAML.visit(doc, {
    Pair(_, pair, ancestors) {
      const key = YAML.isAlias(pair.key) ? pair.key.resolve(doc) : pair.key;
      if (isMergeKey(key)) found.push(pathOf(ancestors));
    },
  });
  return found;
}

function pathOf(ancestors) {
  let at = "";
  ancestors.forEach((node, i) => {
    if (YAML.isPair(node))
      at += (at ? "." : "") + String(node.key?.value ?? node.key);
    else if (YAML.isSeq(node))
      at += `[${node.items.indexOf(ancestors[i + 1])}]`;
  });
  return at || "(root)";
}

/**
 * base の一部を置き換えた fixture を作る。置き換え元がちょうど 1 回出なければ落とす —
 * 無ければ fixture が意味を失い、2 回以上なら意図と別の箇所を書き換えうる
 */
export function replaceOnce(base, from, to) {
  const n = base.split(from).length - 1;
  assert.equal(n, 1, `置き換え元が ${n} 回出る: ${from}`);
  return base.replace(from, to);
}

/** 名前で指定したステップと、それを含む job を全 job から集める */
export const stepsNamed = (doc, name) =>
  Object.entries(doc?.jobs ?? {}).flatMap(([jobName, job]) =>
    (job?.steps ?? [])
      .filter((step) => step?.name === name)
      .map((step) => ({ jobName, job, step }))
  );
