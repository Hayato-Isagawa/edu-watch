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

/**
 * `on:` のトリガー名を返す。1 行形(`on: pull_request`)・列(`on: [push, pull_request]`)・
 * マップ形のどれでも読み、`on:` の中に列 0 のコメントがあっても読める。読めない形は null —
 * 空の `on:`・空の列やマップ・文字列でない要素を含む列・`%YAML 1.1` の下(キーの `on` が
 * 真偽値 true として読まれ、`on` が無くなる)・`true:` と書いた形など。呼ぶ側は null を
 * 「起動しない」と読まずに落とすこと。マージキーは呼ぶ側が `mergeKeyPaths` で落とす
 */
export function triggerNames(on) {
  if (typeof on === "string" && on.trim()) return [on.trim()];
  if (
    Array.isArray(on) &&
    on.length > 0 &&
    on.every((t) => typeof t === "string" && t.trim())
  )
    return on.map((t) => t.trim());
  if (on !== null && typeof on === "object" && !Array.isArray(on)) {
    const keys = Object.keys(on);
    if (keys.length > 0) return keys;
  }
  return null;
}

/**
 * 手元の yaml と GitHub の runner とで読みが食い違いうる書き方のうち、次のものを返す(空なら、どれも無い)。
 * テストは手元の yaml や行単位の取り出しで workflow を読むので、どれもテストが緑のまま本番の挙動だけを変えうる。
 * runner 側の挙動は、どれも actions/runner と YamlDotNet 5.3.0 のソースを読んで確かめただけで、実行はしていない。
 *
 * - 単独の CR・U+0085・U+2028・U+2029: yaml はコメントの中ではコメントの続きとして読むが、runner が使う
 *   YamlDotNet(`CharacterAnalyzer.IsBreak`)は改行として読む
 * - yaml のエラーと警告(未知のタグ・未知のディレクティブなど): yaml は警告を出して読み進める
 * - 明示したタグ: actions/runner の `YamlObjectReader` は、スカラーに付いた未知のタグや、引用符付きの
 *   値に付いた bool / int / float / null のタグで例外を投げ、マップや列に付いたタグは見ない(yaml は
 *   `!!set` を Set として読む)。`!!int "5"` のように yaml が警告を出さずに値へ解決するものもあるので、
 *   workflow では使わないタグを、付いていること自体で落とす
 * - `%YAML` と `%TAG` のディレクティブ: yaml は警告を出さずに受けるが、runner が pin する YamlDotNet 5.3.0 は
 *   `%YAML 1.2` を例外にし、`%YAML 1.1` の下では yaml が `yes` を true と読む。workflow では使わないので落とす
 * - タブ・LF・CR 以外の制御文字(C0・DEL・C1): このうち U+0085 は、上のとおり YamlDotNet が改行として読む。
 *   残りで読みが食い違うのは NUL で、yaml がコメントの続きとして読むのに、YamlDotNet の Scanner はそこで読む
 *   のをやめて例外を投げる。ほかの制御文字は YamlDotNet も yaml と同じく中身として読むとみられるが、workflow
 *   では使わないので一緒に落とす
 * - マップや列をキーにした形(`[x]: 1`): yaml は文字列に直して読むが、actions/runner の `TemplateReader` は
 *   マップの終わりを期待して例外を投げる(文字列でないキーとして落ちる)
 * - 文字列でないキー(null・数値・真偽値): runner の `TemplateReader` はキーを `ToString()` で文字列にしてから
 *   重複を判定するが、書式が JS と違う(null は空文字、数値は G15 書式)。`null:` と `"":` のように、yaml は
 *   後勝ちで 1 つに畳み、runner は重複として拒む組がありうるので、使っていること自体を落とす
 * - エイリアスをキーにした形: yaml はエイリアスで書いたキー(`&k t:` と `*k :`)の重複を検出せず後勝ちで読む。
 *   runner は、アンカーを一律に拒む読み方(src/Sdk/DTPipelines の `YamlObjectReader`)か、アンカーを控えて
 *   エイリアスのところで読み直したうえで `TemplateReader` が重複として拒む読み方(src/Sdk/WorkflowParser の
 *   `YamlObjectReader` に `ParseOptions.AllowAnchors` を渡す経路)のどちらかで、GitHub がどちらで読むかは
 *   確かめていないが、どちらでも yaml と食い違う。workflow では使わないので、使っていること自体を落とす(文字列で
 *   ないキーとして落ちる)
 * - キーの重複: runner は大文字小文字を区別せずに重複を判定する。文字列のキーを大文字小文字をそろえて比べる
 *
 * github.com のサーバーが runner と同じ実装で workflow を読むかは未検証。
 */
export function ambiguousYaml(src) {
  const found = [];
  if (/[\r\u0085\u2028\u2029]/.test(src.replace(/\r\n/g, "\n")))
    found.push("行区切りに使われうる文字がある");
  // 正規表現に制御文字を書くと lint(no-control-regex)に当たるので、文字コードで見る
  const isControl = (n) =>
    (n < 0x20 && n !== 0x09 && n !== 0x0a && n !== 0x0d) ||
    n === 0x7f ||
    (n >= 0x80 && n <= 0x9f);
  if ([...src].some((c) => isControl(c.charCodeAt(0))))
    found.push("タブ・LF・CR 以外の制御文字がある");
  const doc = YAML.parseDocument(src, { merge: false });
  for (const e of [...doc.errors, ...doc.warnings])
    found.push(`yaml: ${e.message}`);
  if (doc.directives?.yaml?.explicit) found.push("%YAML ディレクティブがある");
  if (Object.keys(doc.directives?.tags ?? {}).some((h) => h !== "!!"))
    found.push("%TAG ディレクティブがある");
  if (doc.directives?.tags?.["!!"] !== "tag:yaml.org,2002:")
    found.push("%TAG で !! を差し替えている");
  YAML.visit(doc, {
    Node(_, node) {
      if (node.tag) found.push(`タグ: ${node.tag}`);
    },
  });
  // マップは別の走査で見る。同じ走査に Map を足すと、yaml はマップに Node を呼ばなくなり、マップのタグを見落とす
  YAML.visit(doc, {
    Map(_, map) {
      const seen = new Set();
      for (const pair of map.items) {
        const key = pair.key;
        const value = YAML.isScalar(key) ? key.value : key;
        // マップや列・エイリアスのキーもここで落ちる(スカラーではないので、値が文字列にならない)
        if (typeof value !== "string") {
          found.push(`文字列でないキー: ${String(value)}`);
          continue;
        }
        const name = value.toLowerCase();
        if (seen.has(name)) found.push(`キーの重複: ${name}`);
        seen.add(name);
      }
    },
  });
  return found;
}
