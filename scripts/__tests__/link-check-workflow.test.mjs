// link-check.yml の「検出をどう届けるか」の分岐を固定する。
//
// このステップは壊れても**静かに**壊れる。lychee は走り続け、レポートも
// アーティファクトに残り、job は success で終わる。消えるのは通知だけなので、
// CI を見ている限り何も起きていないように見える。
//
// 実際に起きた(姉妹リポ okinawa-in-data、このリポと同じコードを共有していた):
// 2026-08-17 の run は `web.archive.org/save/` の 404 を検出していたが、当時 open な
// link-check Issue があったため「既存 Issue があるので作らない」の分岐に入り exit 0。
// この検出は 2 日後にその Issue を閉じるまでどこにも出ず、握り潰す状態自体は
// Issue が open だった 9 日間ずっと有効だった。気づいたのは run のアーティファクトまで
// 降りたからで、Issue 一覧を見ている限り分からなかった(okinawa-in-data#107 / #110)。
//
// 写しを置かず、**ワークフローに埋まっている本体**を取り出して走らせる。gh はスタブに差し替え、渡された引数を全部記録して、
// 「誰に」「何を」届けたかまで見る。exit code だけ見ると、宛先が変わっても
// 本文が空になっても素通りする。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, '..', '..', '.github', 'workflows', 'link-check.yml');

/**
 * レポートのファイル名は、ワークフローの `output:` から取る。**テストに書き写さない。**
 * 写すと、正当な一斉リネーム(YAML と参照 5 箇所を揃えて変える)でテストだけが取り残され、
 * 8 件が失敗する（実測）。名前が変わったこと自体は下の「出力先とシェルが読むファイル名が
 * 一致している」が見るので、ここは追随するだけでよい。
 */
const REPORT_FILE = (() => {
  const m = fs.readFileSync(WORKFLOW, 'utf8').match(/^ {10}output: (\S+)$/m);
  assert.ok(m, 'lychee の output: を読み取れない');
  return m[1];
})();
const RE_REPORT = REPORT_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ワークフローの `run: |` ブロックを取り出す。
 * link-check.yml の `run: |` は Report broken links ステップの 1 つだけ。
 * 2 つ目が増えたらこの前提が崩れるので、そのことも下でテストしている。
 */
function extractRunBlock(yamlPath) {
  const lines = fs.readFileSync(yamlPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.notEqual(start, -1, 'run: | ブロックが見つからない');

  const body = lines.slice(start + 1);
  const indent = body[0].length - body[0].trimStart().length;
  const out = [];
  for (const line of body) {
    const isBlank = line.trim() === '';
    if (!isBlank && line.length - line.trimStart().length < indent) break;
    out.push(line.slice(indent));
  }
  return out.join('\n');
}

/**
 * 本文へ載せるレポートの上限バイト数を、ワークフロー本体から読む。
 * **テスト側に数値を写さない。** 写すとワークフローを変えたときにここだけ古くなる。
 */
function truncationLimit() {
  const m = extractRunBlock(WORKFLOW).match(new RegExp(`^ *head -c (\\d+) ${RE_REPORT}$`, 'm'));
  assert.ok(m, 'head -c の上限が読み取れない');
  return Number(m[1]);
}

const REPORT = [
  '# Summary',
  '',
  '| 🚫 Errors      | 1     |',
  '',
  '## Errors per input',
  '',
  '* [404] <https://example.invalid/gone> | Rejected status code: 404 Not Found',
].join('\n');

/**
 * Report broken links ステップを 1 回走らせる。
 *
 * @param existing  `gh issue list` が返す番号。空文字なら「open な Issue 無し」。
 * @param report    レポート(`output:` のファイル)の中身。null なら作らない。
 * @param fail      失敗させる gh サブコマンド('issue list' / 'issue comment' / 'issue create')。
 *                  gh が失敗したときに**赤くなる**ことを固定するために使う。ここが緑のまま
 *                  通ると、API エラーで通知が消えても誰も気づけない。
 * @param exitCode  lychee の終了コード(`LYCHEE_EXIT_CODE`)。レポートを出せなかった回の
 *                  本文に載る。
 * @param outcome   lychee ステップの outcome(`LYCHEE_OUTCOME`)。continue-on-error を
 *                  適用する**前**の結果。`exitCode='0'` と `outcome='failure'` の組で
 *                  「1 本もリンクを見なかった回」を表す。
 */
function runStep({ existing = '', report = REPORT, fail = null, exitCode = '2', outcome = 'success' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linkcheck-')));
  const stubs = path.join(dir, 'stubs');
  fs.mkdirSync(stubs);

  if (report !== null) fs.writeFileSync(path.join(dir, REPORT_FILE), report);

  // gh のスタブ。issue list は与えた番号を返し、create / comment は本文を控える。
  // **引数を全部記録する。** 宛先(どの Issue にコメントしたか)とラベルは
  // exit code に出ないので、記録しないと検証できない。
  fs.writeFileSync(
    path.join(stubs, 'gh'),
    `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$*" >> "$DIR/gh-args"
if [ -n "\${FAIL_ON:-}" ] && [ "$1 \${2:-}" = "$FAIL_ON" ]; then
  echo "HTTP 403: Resource not accessible by integration" >&2
  exit 1
fi
case "$1 \${2:-}" in
  "label create") ;;
  "issue list") cat "$DIR/existing" ;;
  "issue create")
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--body-file" ]; then cp "$a" "$DIR/created-body"; fi
      prev="$a"
    done
    echo "https://example.invalid/issues/1"
    ;;
  "issue comment")
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--body-file" ]; then cp "$a" "$DIR/commented-body"; fi
      prev="$a"
    done
    echo "https://example.invalid/issues/1#comment"
    ;;
  *) echo "unexpected gh: $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );

  fs.writeFileSync(path.join(dir, 'existing'), existing ? `${existing}\n` : '');

  const script = path.join(dir, 'step.sh');
  fs.writeFileSync(script, extractRunBlock(WORKFLOW));

  const res = spawnSync('bash', [script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${stubs}:${process.env.PATH}`,
      DIR: dir,
      GH_TOKEN: 'stub',
      RUN_URL: 'https://example.invalid/actions/runs/12345',
      LYCHEE_EXIT_CODE: exitCode,
      LYCHEE_OUTCOME: outcome,
      ...(fail ? { FAIL_ON: fail } : {}),
    },
  });

  const read = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const out = {
    code: res.status,
    out: `${res.stdout}${res.stderr}`,
    ghArgs: (read('gh-args') ?? '').trim().split('\n').filter(Boolean),
    createdBody: read('created-body'),
    commentedBody: read('commented-body'),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

const calls = (r, prefix) => r.ghArgs.filter((a) => a.startsWith(prefix));

test('open な Issue が無ければ、新しく Issue を立てる', () => {
  const r = runStep({ existing: '' });
  assert.equal(r.code, 0, r.out);
  assert.equal(calls(r, 'issue create').length, 1, r.ghArgs.join(' / '));
  assert.equal(calls(r, 'issue comment').length, 0, '新規のはずがコメントしている');
  assert.match(r.createdBody, /週次の自動リンクチェックが問題を検出しました/);
  // タイトルは「リンク切れ」と名乗らない。lychee は Errors 0 / Timeouts 1 でも
  // 非ゼロ終了する(実測)ので、切れていない回に「Broken links detected」と出ていた。
  assert.match(calls(r, 'issue create')[0], /Link check found problems/);
});

test('open な Issue があるときは、握り潰さずコメントする', () => {
  const r = runStep({ existing: '90' });
  assert.equal(r.code, 0, r.out);
  // これが今回塞いだ穴そのもの。ここが 0 件になったら、検出は再びどこにも出なくなる。
  assert.equal(calls(r, 'issue comment').length, 1, '既存 Issue にコメントしていない');
  assert.equal(calls(r, 'issue create').length, 0, 'Issue を増やしている');
});

test('コメントの宛先は、見つかった Issue 番号である', () => {
  const r = runStep({ existing: '4242' });
  const call = calls(r, 'issue comment')[0];
  assert.ok(call, 'コメントが呼ばれていない');
  assert.match(call, /\b4242\b/, `宛先が違う: ${call}`);
});

test('コメントにもレポート本体と run URL が入る', () => {
  const r = runStep({ existing: '90' });
  assert.ok(r.commentedBody, 'コメント本文が記録されていない');
  // 要約だけにして中身を落とすと、読み手は毎回 run を開く羽目になる。
  assert.match(r.commentedBody, /Errors per input/);
  assert.match(r.commentedBody, /example\.invalid\/gone/);
  assert.match(r.commentedBody, /actions\/runs\/12345/);
  // 放置の代償を書いておく。`/close/` だけだと、元からある
  // 「修正が完了したらこの Issue を close してください」でも通ってしまう。
  assert.match(r.commentedBody, /新しい Issue は立ちません/);
});

test('新規 Issue の本文にもレポート本体が入る', () => {
  const r = runStep({ existing: '' });
  assert.match(r.createdBody, /Errors per input/);
  assert.match(r.createdBody, /example\.invalid\/gone/);
  assert.match(r.createdBody, /actions\/runs\/12345/);
});

test('新規 Issue には link-check ラベルが付く', () => {
  const r = runStep({ existing: '' });
  // このラベルは次回以降の重複判定(gh issue list --label link-check)の入力そのもの。
  // 落ちると毎週 Issue が増える。
  assert.match(calls(r, 'issue create')[0], /link-check/);
});

// レポートが「読めるか」で分けた回について。このステップは lychee が非ゼロで
// 終わったときにしか走らない。集計まで到達した回は必ず `# Summary` から始まる
// markdown が出るので、それが無い回は lychee が集計前に落ちたと読む。
//
// **「空かどうか」では分けられない。** pin した action は出力先を先に作るので、
// lychee が 1 バイトも書かずに落ちてもフッタ 1 行の非空ファイルが残る(後述の
// 「lychee が集計に到達しなかった回も、レポート扱いしない」で固定している)。
//
// 以前はここで黙って exit 0 していた。lychee は continue-on-error なので job も緑になり、
// 「毎週走っているのに永久に何も出ない」状態が成立していた。

test('レポートが空でも、通知だけは出す', () => {
  const r = runStep({ existing: '', report: '' });
  assert.equal(r.code, 0, r.out);
  // 何が切れたかは分からない。分からないこと自体を届ける。
  assert.equal(calls(r, 'issue create').length, 1, 'レポートが無いと黙って終わっている');
});

test('レポートが無くても、通知だけは出す', () => {
  const r = runStep({ existing: '', report: null });
  assert.equal(r.code, 0, r.out);
  assert.equal(calls(r, 'issue create').length, 1, 'レポートが無いと黙って終わっている');
});

test('レポートを出せなかった回は、リンク切れと別のタイトルで立てる', () => {
  const r = runStep({ existing: '', report: null });
  const call = calls(r, 'issue create')[0];
  // 同じタイトルにすると、「チェックが動かなかった」が「リンクが切れた」に化ける。
  assert.match(call, /could not produce a report/, `タイトルが区別されていない: ${call}`);
  assert.doesNotMatch(call, /found problems/);
});

test('レポートを出せなかった回は、lychee の終了コードを本文に載せる', () => {
  const r = runStep({ existing: '', report: null, exitCode: '77' });
  // 唯一の手がかりなので落とさない。
  assert.match(r.createdBody, /77/, '終了コードが本文に無い');
  assert.match(r.createdBody, /何が切れたかは分かりません/);
  assert.match(r.createdBody, /actions\/runs\/12345/);
});

test('終了コードが取れなかったときは unknown と書く', () => {
  // action がクラッシュして output を書けないと、この値は空文字で届く
  // ＝まさにこのケースの主役。`:-` を `-` にすると「終了コード: 」と尻切れになる。
  const r = runStep({ existing: '', report: null, exitCode: '' });
  assert.match(r.createdBody, /終了コード: unknown/, `空のまま出ている: ${r.createdBody}`);
});

test('新規 Issue には、次に何をすればいいかが書いてある', () => {
  // lead(何が起きたか)だけでは動けない。分岐ごとに宛先が違う。
  const found = runStep({ existing: '' });
  assert.match(found.createdBody, /差し替えか代替リンク/, '対処の手がかりが無い');
  const missing = runStep({ existing: '', report: null });
  assert.match(missing.createdBody, /Download and extract lychee/, '対処の手がかりが無い');
  // 取り違えると、レポートが無いのに「URL を差し替えろ」と言うことになる。
  assert.doesNotMatch(missing.createdBody, /差し替えか代替リンク/);
});

test('レポートが無い回のコメントは、存在しないレポートを読ませない', () => {
  const r = runStep({ existing: '90', report: null });
  assert.doesNotMatch(r.commentedBody, /下のレポートに/, '無いレポートを参照させている');
  assert.match(r.commentedBody, /照合できる URL の一覧もありません/);
});

test('コメントにも、次に何をすればいいかが載る', () => {
  // 新規 Issue にだけ hint を載せると、既存 Issue が open の間ずっと
  // 「何が起きたか」だけが積まれ、「どうすればいいか」は誰にも届かない。
  const r = runStep({ existing: '90', report: null });
  assert.match(r.commentedBody, /Download and extract lychee/, '対処の手がかりが無い');
});

test('lychee が集計に到達しなかった回も、レポート扱いしない', () => {
  // pin した action は出力先を mktemp で先に作るので、lychee が panic しても
  // フッタ 1 行だけの**非空**ファイルが残る(entrypoint.sh:73 の [ ! -f ] は
  // 決して真にならない)。`-s` だけで判定すると、この回が「リンク切れを検出した」
  // 扱いになり、中身がフッタ 1 行だけの Issue が立つ。
  const footerOnly = '[Full Github Actions output](https://example.invalid/runs/1)\n';
  const r = runStep({ existing: '', report: footerOnly });
  assert.equal(r.code, 0, r.out);
  const call = calls(r, 'issue create')[0];
  assert.match(call, /could not produce a report/, `フッタだけの出力を検出扱いしている: ${call}`);
  assert.match(r.createdBody, /チェックそのものが完走しなかった/);
});

test('Summary は行頭の見出しとして探す', () => {
  // `grep -q 'Summary'` に緩めると、本文のどこかに Summary という語がある
  // フッタ壊れレポートまで「読める」判定になる。lychee の markdown 出力は
  // `# Summary` を先頭行に置くので、行頭の見出しとして縛る。
  const mentionsSummary = 'Some prose that says Summary in passing.\n[Full Github Actions output](https://example.invalid/runs/1)\n';
  const r = runStep({ existing: '', report: mentionsSummary });
  const call = calls(r, 'issue create')[0];
  assert.match(call, /could not produce a report/, `語の出現だけで検出扱いしている: ${call}`);
});

test('レポートが無い回の日付は「実行日」と書く', () => {
  // 何も検出していないので「検出日」は嘘になる。
  const missing = runStep({ existing: '', report: null });
  assert.match(missing.createdBody, /実行日 \(UTC\)/, `日付ラベルが実態と違う`);
  assert.doesNotMatch(missing.createdBody, /検出日 \(UTC\)/);
  // 検出があった回は従来どおり「検出日」。
  const found = runStep({ existing: '' });
  assert.match(found.createdBody, /検出日 \(UTC\)/);
});

test('レポートを出せなかった回は、ありもしない修正を促さない', () => {
  const r = runStep({ existing: '', report: null });
  // 直すべきリンクは 1 つも報告されていない。「修正が完了したら close」と書くと、
  // 読み手は存在しないリンク切れを探しに行く。close の案内は両分岐で共通なので、
  // 検出があった回にも成り立つ中立な言い方にする。
  assert.match(r.createdBody, /対応が終わったらこの Issue を close/);
  assert.doesNotMatch(r.createdBody, /修正が完了したら/);
});

test('コメントの冒頭は、検出が無かった回でも嘘にならない', () => {
  // lychee が転んだ回は「検出」がゼロ。冒頭で「別の検出がありました」と言うと、
  // すぐ下の lead(「何が切れたかは分かりません」)と真正面から矛盾する。
  const r = runStep({ existing: '90', report: null });
  assert.doesNotMatch(r.commentedBody, /別の検出がありました/);
  assert.match(r.commentedBody, /この Issue が open の間に、別の報告がありました/);
});

test('レポートを出せなかった回も、既存 Issue があればコメントに回る', () => {
  const r = runStep({ existing: '90', report: null });
  // ここを別経路にすると、「Issue を増やさない」が裏口から壊れる。
  assert.equal(calls(r, 'issue comment').length, 1, '既存 Issue にコメントしていない');
  assert.equal(calls(r, 'issue create').length, 0, 'Issue を増やしている');
  assert.match(r.commentedBody, /レポートを出せずに終了しました/);
});

// ここまでは「見つけた既存 Issue をどう扱うか」。以下は「既存 Issue をどう探すか」。
// 探し方が壊れると、扱い方が正しくても結果は同じだけ悪くなる — 別ラベルを見に行けば
// 毎週 Issue が増え、closed も対象にすれば新規 Issue が二度と立たない。
// スタブは結果を注入するだけなので、照会そのものは引数を見るしかない。

test('既存 Issue は link-check ラベルの open だけを探す', () => {
  const r = runStep({ existing: '90' });
  const call = calls(r, 'issue list')[0];
  assert.ok(call, 'gh issue list が呼ばれていない');
  // ラベルが外れる/変わると、無関係な Issue にレポートを投げるか、毎週 Issue が増える。
  // `\b` では止まらない — ハイフンの直前でも成立するので `link-check-v2` が素通りする。
  assert.match(call, /--label link-check(?=\s|$)/, `照会ラベルが違う: ${call}`);
  // closed まで拾うと、閉じた Issue にコメントし続けて新規が立たなくなる。
  assert.match(call, /--state open(?=\s|$)/, `照会する状態が違う: ${call}`);
});

test('探すラベルと、新規作成で付けるラベルが一致している', () => {
  // 片方だけ改名すると、次の週から既存 Issue を見つけられず毎週 Issue が増える。
  // どちらの呼び出しも実際の引数から取るので、ラベル名をテストに写さずに突き合わせられる。
  // スタブは `$*` で記録するので引用符は落ちている。create 側はカンマ区切りの 1 語。
  const listed = calls(runStep({ existing: '90' }), 'issue list')[0].match(/--label (\S+)/)[1];
  const created = calls(runStep({ existing: '' }), 'issue create')[0]
    .match(/--label (\S+)/)[1]
    .split(',');
  assert.ok(
    created.includes(listed),
    `作成時のラベル ${created.join(',')} に、照会するラベル ${listed} が無い`,
  );
});

test('既存 Issue の番号は先頭 1 件だけを取り、無ければ空にする', () => {
  const r = runStep({ existing: '90' });
  const call = calls(r, 'issue list')[0];
  // `empty` に潰すと常に新規作成になり、`.[]` にすると番号が複数行で返って宛先が壊れる。
  assert.match(call, /\.\[0\]\.number/, `番号の取り出し方が違う: ${call}`);
  // `// empty` が落ちると、0 件のとき jq が `null` を返す。`[ -n "null" ]` は真なので
  // コメント分岐へ入り、`gh issue comment null` で落ちる。赤くはなるが、
  // 「最初の 1 件が Issue にならない」形で落ちるので、ここで縛っておく。
  assert.match(call, /\/\/ empty/, `0 件のときに空を返す形になっていない: ${call}`);
});

test('gh issue list が失敗したら、ステップごと落ちる', () => {
  const r = runStep({ existing: '90', fail: 'issue list' });
  // ここで握り潰すと「既存 Issue 無し」と誤認して Issue を量産する。
  assert.notEqual(r.code, 0, 'API エラーなのに成功扱いになっている');
  assert.equal(calls(r, 'issue create').length, 0);
  assert.equal(calls(r, 'issue comment').length, 0);
});

test('gh issue comment が失敗したら、ステップごと落ちる', () => {
  const r = runStep({ existing: '90', fail: 'issue comment' });
  // 通知が消えたのに job が緑だと、今回直した穴がそのまま戻る。
  assert.notEqual(r.code, 0, 'コメントに失敗したのに成功扱いになっている');
});

test('gh issue create が失敗したら、ステップごと落ちる', () => {
  const r = runStep({ existing: '', fail: 'issue create' });
  assert.notEqual(r.code, 0, 'Issue 作成に失敗したのに成功扱いになっている');
});

// 次の 3 件は run: ブロックの外側。ステップに届く前に潰される経路は、
// スクリプトをいくら走らせても見えない。
//
// **インデントまで固定する。** YAML は同じキーが階層違いで並ぶので、
// 深さを見ないと「どこかに 1 行あれば緑」になる。実際 `^ +issues: write$` は、
// job 側を read に落としてワークフロー全体に write を足すと素通りした
// (実効権限は job 側＝read なので、本番では通知だけが 403 で消える)。
// 姉妹リポ(portfolio / okinawa-in-data)の同名テストも同じ深さで締めている。
const yaml = () => fs.readFileSync(WORKFLOW, 'utf8');

test('通知ステップは lychee が異常終了した回に走る', () => {
  // `!= '0'` を `== '0'` にすると、検出があった回にだけ走らなくなる。
  // 挙動は「毎回 Issue が立たない」で、CI は緑のまま。今回直した穴と同型。
  //
  // **ステップ名とペアで見る。** 条件だけを探すと、同じ行を別のステップへ移しても
  // 通ってしまう(通知ステップは起動条件を失って毎回走るようになる)。行末まで縛るのは、
  // 後ろに `&& github.event_name == 'schedule'` のような絞り込みを足す変更を止めるため。
  assert.match(
    yaml(),
    /^ {6}- name: Report broken links\n {8}if: steps\.lychee\.outputs\.exit_code != '0' \|\| steps\.lychee\.outcome == 'failure'$/m,
  );
});

test('Issue を書く権限が job に宣言されている', () => {
  // read に落ちると、検出はあるのに通知だけが 403 で消える。
  assert.match(yaml(), /^ {6}issues: write$/m);
});

test('lychee ステップは continue-on-error で、通知ステップを skip させない', () => {
  // **この 1 行が「必ず人に届く」の前提。** 通知ステップの if: はステータス関数を
  // 含まないので、GitHub は暗黙に success() を前置する(公式ドキュメント)。
  // continue-on-error が外れると、lychee が転んだ回は conclusion が failure になり、
  // success() が偽 → **通知ステップごと skip** される。
  // つまり「lychee 自体が壊れた回に通知する」というこの PR の目的が、
  // ワークフローの別の行 1 つで無効化される。
  // `id:` も一緒に縛る。消えると `steps.lychee.outputs.exit_code` が空文字になり、
  // `'' != '0'` が真＝**リンクが全部生きていても毎週 Issue が立つ**。
  assert.match(yaml(), /^ {6}- name: Run lychee\n {8}id: lychee\n(?: {8}.*\n)*? {8}continue-on-error: true$/m);
});

test('lychee の終了コードが env で渡っている', () => {
  // レポートを出せなかった回の唯一の手がかり。テストハーネスは環境変数を
  // 直接注入するので、**YAML の env: が消えてもシェル側のテストは緑になる**。
  // 配線そのものをここで見る(RUN_URL と同じ扱い)。
  assert.match(
    yaml(),
    /^ {10}LYCHEE_EXIT_CODE: \$\{\{ steps\.lychee\.outputs\.exit_code \}\}$/m,
  );
});

test('レポートの有無は 1 回だけ判定する', () => {
  // タイトル・案内文・本文が別々に `[ -s <レポート> ]` を見ていると、
  // 片方だけずれても動いてしまう(「リンク切れを見つけた」というタイトルの Issue に
  // 「レポートは出ませんでした」が入る)。判定は 1 箇所に集約する。
  const block = extractRunBlock(WORKFLOW);
  const checks = block.match(new RegExp(`\\[ +-s +${RE_REPORT} +\\]`, 'g')) ?? [];
  assert.equal(checks.length, 1, `レポート有無の判定が ${checks.length} 箇所ある`);
  assert.match(block, /has_report=/, '判定結果を変数に控えていない');
});

test('通知本文に入れる run URL が env で渡っている', () => {
  // キーの存在だけ見ると、値を潰しても通る。run URL は上限で切られた続き
  // (アーティファクト)へ辿る唯一の導線なので、式ごと固定する。
  assert.match(
    yaml(),
    /^ {10}RUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}$/m,
  );
});

test('長いレポートは切り詰められ、切ったことが本文に出る', () => {
  // Issue 本文には上限がある。切り詰め自体は必要だが、黙って切ると
  // 「レポートに出ていない = 検出されていない」と読まれる。
  //
  // **上限の値はテストに写さない。** 写すとワークフロー側を変えたときにここだけ
  // 古くなる。読み取った
  // 上限の**すぐ内側と、すぐ外側**に目印を置く。余白を大きく取ると、`head -c` を
  // 何割か変えても両方の assert を満たしてしまい、感度が桁で粗くなる。
  const limit = truncationLimit();
  const kept = 'KEPT-JUST-INSIDE-THE-LIMIT\n';
  const cut = 'CUT-JUST-OUTSIDE-THE-LIMIT\n';
  const head = `${REPORT}\n`;
  const margin = 10;

  // kept の末尾が上限の margin バイト内側、cut の先頭が margin バイト外側に来るよう詰める。
  const fill = limit - Buffer.byteLength(head) - Buffer.byteLength(kept) - margin;
  assert.ok(fill > 0, `上限が小さすぎて fixture を組めない: ${limit}`);
  const long = head + 'x'.repeat(fill) + kept + 'y'.repeat(margin * 2) + cut + 'z'.repeat(100);

  const r = runStep({ existing: '', report: long });
  assert.equal(r.code, 0, r.out);
  assert.match(r.createdBody, /KEPT-JUST-INSIDE-THE-LIMIT/, '上限の内側まで載っていない');
  assert.doesNotMatch(r.createdBody, /CUT-JUST-OUTSIDE-THE-LIMIT/, '上限を超えて載っている');
  assert.match(r.createdBody, /末尾を省略しました/, '切ったことが書かれていない');
});

test('切り詰める長さと、注記を出す閾値が同じ値である', () => {
  // この 2 つは対でないと意味がない。注記側だけ大きくすると、本文は上限で
  // 切れているのに「省略しました」が出ない — このテスト群が防ごうとしている
  // 読み違い(出ていない = 検出されていない)そのものが起きる。
  // 両方ワークフローから読むので、数値はテストに写らない。
  const block = extractRunBlock(WORKFLOW);
  const cut = block.match(new RegExp(`^ *head -c (\\d+) ${RE_REPORT}$`, 'm'));
  const note = block.match(
    new RegExp(`^ *if \\[ "\\$\\(wc -c < ${RE_REPORT}\\)" -gt (\\d+) \\]; then$`, 'm'),
  );
  assert.ok(cut, '切り詰める長さが読み取れない');
  assert.ok(note, '注記を出す閾値が読み取れない');
  assert.equal(note[1], cut[1], `切り詰めは ${cut[1]} なのに注記の閾値が ${note[1]}`);
});

test('上限に届かないレポートには省略注記を付けない', () => {
  // `-gt` を `-ge` や `-gt 0` にすると、短いレポートにも「省略しました」が付き、
  // 読み手は出ていない URL があると誤解する。
  const r = runStep({ existing: '', report: REPORT });
  assert.doesNotMatch(r.createdBody, /末尾を省略しました/);
});

// 1 本もリンクを見なかった回について。pin した action は `failIfEmpty`(既定 true)が
// 効くと、**lychee の終了コードを 0 のまま残して自分だけ exit 1 する**
// (entrypoint.sh:61-62 のコメントが明言)。`exit_code != '0'` だけを見ていると
// この回は通知が skip され、lychee は continue-on-error なので job も緑になる。
// = 週次チェックが恒久的に no-op になっても誰も気づけない。

test('1 本も見なかった回も、通知だけは出す', () => {
  const r = runStep({ existing: '', exitCode: '0', outcome: 'failure' });
  assert.equal(r.code, 0, r.out);
  assert.equal(calls(r, 'issue create').length, 1, '0 件の回に黙って終わっている');
});

test('1 本も見なかった回は、検出とも未完走とも別のタイトルで立てる', () => {
  const r = runStep({ existing: '', exitCode: '0', outcome: 'failure' });
  const call = calls(r, 'issue create')[0];
  // 「問題を検出した」でも「レポートを出せなかった」でもない。設定の問題。
  assert.match(call, /found no links to check/, `タイトルが区別されていない: ${call}`);
  assert.doesNotMatch(call, /found problems/);
  assert.doesNotMatch(call, /could not produce a report/);
});

test('1 本も見なかった回は、設定を疑わせる案内を出す', () => {
  const r = runStep({ existing: '', exitCode: '0', outcome: 'failure' });
  assert.match(r.createdBody, /1 本もリンクを見ませんでした/);
  assert.match(r.createdBody, /走査対象のパターン/, '対処の手がかりが無い');
  // リンク切れの話にすり替えない。
  assert.doesNotMatch(r.createdBody, /差し替えか代替リンク/);
  assert.match(r.createdBody, /実行日 \(UTC\)/, '検出していないのに「検出日」と書いている');
});

test('1 本も見なかった回も、既存 Issue があればコメントに回る', () => {
  const r = runStep({ existing: '90', exitCode: '0', outcome: 'failure' });
  assert.equal(calls(r, 'issue comment').length, 1, '既存 Issue にコメントしていない');
  assert.equal(calls(r, 'issue create').length, 0, 'Issue を増やしている');
  assert.match(r.commentedBody, /1 本もリンクを見ませんでした/);
});

test('lychee が正常終了した回は、0 件扱いにしない', () => {
  // outcome が success なら failIfEmpty は効いていない。ここを取り違えると、
  // 検出があった回まで「設定の問題」と案内してしまう。
  const r = runStep({ existing: '', exitCode: '2', outcome: 'failure' });
  const call = calls(r, 'issue create')[0];
  assert.match(call, /found problems/, `検出のある回を 0 件扱いしている: ${call}`);
});

test('lychee の outcome が env で渡っている', () => {
  // ハーネスは環境変数を直接注入するので、**YAML の env: が消えてもシェル側のテストは
  // 緑になる**。0 件の回を見分ける唯一の手がかりなので、配線そのものをここで見る。
  assert.match(yaml(), /^ {10}LYCHEE_OUTCOME: \$\{\{ steps\.lychee\.outcome \}\}$/m);
});

test('通知ステップは continue-on-error で黙らない', () => {
  // lychee 側は continue-on-error が**あること**を固定しているのに、通知側は
  // **無いこと**を誰も見ていなかった。1 行足すだけで gh の 403 が job に伝わらなくなり、
  // 「gh が失敗したら赤くなる」を固定した 3 本が丸ごと無意味になる(シェルの exit code は
  // 非ゼロのままなので、走らせる形のテストでは原理的に捕まらない)。
  // **ステップ全体を見る。** 以前は `run: |` の手前までしか見ていなかったが、YAML の
  // マッピングキーは順不同なので `continue-on-error: true` を `run:` の**後ろ**に置けば
  // 有効な YAML として効く(実測: 置いても 47 件が緑のまま通った)。run ブロックの中身は
  // 10 スペース以上なので、8 スペース固定で見れば本文と取り違えない。
  const src = yaml();
  const from = src.indexOf('      - name: Report broken links');
  const after = src.slice(from + 1);
  const next = after.search(/^ {6}- name: /m);
  const step = next === -1 ? src.slice(from) : src.slice(from, from + 1 + next);
  assert.doesNotMatch(step, /^ {8}continue-on-error/m, '通知ステップの失敗が握り潰される');
});

test('レポートのアップロードは、欠けていても job を落とさない', () => {
  // Upload は lychee と通知の間にある。`if-no-files-found: error` にすると job が failure に
  // なり、通知ステップの暗黙の success() が偽 → **レポートが出なかった回にだけ**通知が
  // 消える。この PR の主目的をピンポイントで無効化する経路なので塞ぐ。
  // pin した upload-artifact(043fb46)の既定は warn。
  const src = yaml();
  const step = src.slice(src.indexOf('      - name: Upload report'));
  const head = step.slice(0, step.indexOf('      # **exit_code だけでは足りない。**'));
  assert.doesNotMatch(head, /if-no-files-found:\s*error/, 'レポート欠落で job が落ちる');
  // 欠落以外の理由(API エラー等)で落ちても同じことが起きるので、ステップごと
  // 「落ちない」ようにする。ここが failure になると通知ステップの暗黙の success() が
  // 偽になり、**アップロードの失敗という無関係な理由で通知だけが消える**。
  assert.match(head, /^ {8}continue-on-error: true$/m, 'アップロードの失敗が通知を殺す');
});

test('0 件を検出できる設定が固定されている', () => {
  // 「1 本も見なかった回も通知する」は、`failIfEmpty` が true のときに action が
  // 非ゼロ終了することに全面的に依存している。false にすると lychee も action も
  // 0 終了 = 通知ステップが skip され、**週次チェックが恒久的に no-op になる**。
  // しかもその設定方法は、0 件の回の Issue 本文に lychee 自身が書き込む。
  assert.match(yaml(), /^ {10}failIfEmpty: true$/m, '0 件の回を検出できなくなる');
});

test('lychee-action は読解した版に pin されている', () => {
  // 3 分岐の設計は、この pin の entrypoint.sh の挙動そのもの(exit_code を残して
  // action だけが exit 1 する / mktemp で出力先を先に作る)に依っている。
  // **上げるときは entrypoint.sh を読み直すこと。**
  assert.match(yaml(), /uses: lycheeverse\/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8/);
});

test('checks.yml は main 向けの PR で必ず起動する', () => {
  // 不変条件「壊れたら PR の CI が赤くなる」は on: に依存しているのに、
  // そこを見ているテストが無かった。paths フィルタやトリガ削除で、
  // ステップが残ったまま PR を守らなくなる。
  const b = fs.readFileSync(
    path.join(HERE, '..', '..', '.github', 'workflows', 'checks.yml'),
    'utf8',
  );
  assert.match(b, /^ {2}pull_request:$/m, 'PR トリガが無い');
});

test('lychee の出力先と、シェルが読むファイル名が一致している', () => {
  // ここがずれると、通知は毎週出るのに中身は永久に「レポートを出せませんでした」になる。
  // **名前をテストに書き写さず**、YAML の output: とシェル本体を突き合わせる。
  //
  // **部分一致で見ない。** `includes()` にすると `output: report.md` へ変えても、シェル側の
  // `lychee-report.md` が `report.md` を部分文字列として含むため素通りする(変異試験で実測)。
  // シェルが実際に読んでいる名前を取り出して、完全一致で突き合わせる。
  const out = yaml().match(/^ {10}output: (\S+)$/m);
  assert.ok(out, 'lychee の output: を読み取れない');
  const block = extractRunBlock(WORKFLOW);
  const guard = block.match(/\[ +-s +(\S+) +\]/);
  const cut = block.match(/^ *head -c \d+ (\S+)$/m);
  assert.ok(guard && cut, 'シェルが読むファイル名を取り出せない');
  assert.equal(guard[1], out[1], `有無の判定が ${guard[1]} を見ている(output: は ${out[1]})`);
  assert.equal(cut[1], out[1], `本文へ載せるのが ${cut[1]}(output: は ${out[1]})`);
});

test('lychee の出力形式は markdown で固定されている', () => {
  // 判定に `# Summary` を使っているので、形式が変わると毎回「レポートを出せなかった」に
  // 化ける。通知は出続けるが中身が永久に失われるので、空振りより気づきにくい。
  assert.match(yaml(), /^ {10}format: markdown$/m);
});

test('この検査自身が PR の CI に配線されている', () => {
  // `assert-test-*` は「glob 0 件 / 中身が空 / 全件 skip」を止めるが、その**手前**の
  // 「そもそも CI で走るか」は誰も見ていない。checks.yml からステップを 1 行消すと、
  // このファイルは緑のまま CI から完全に消える。
  //
  // **この検査には原理的な限界がある。** ステップを丸ごと削除されると、この検査自身が
  // 実行されないので赤くならない(捕まえられるのは `if:` の改変・並べ替え・run: 行の
  // 移動まで)。姉妹リポの edu-evidence では、同じ CI を回す**別のゲート**(`test:scripts`)へ
  // 配線の検査を移して塞いだ。このリポにも同じ job で走る下限つきの口(`test:hooks`)は
  // あるので、**同じ手は取れる**。取らないのは、あちらが `.claude/hooks/` の回帰テストで
  // 主題が違い、そこへ CI 配線の検査を置くと後から読む人が置き場所を追えなくなるため。
  // 塞ぐなら専用の口を作る必要があり、それは別の変更にする。
  //
  // **ステップ名では探さない。** 名前を書き写すと改名だけで赤くなる。守りたいのは
  // 「この run: が !cancelled() の下にある」ことなので、run: 行に直接括り付ける。
  const b = fs.readFileSync(
    path.join(HERE, '..', '..', '.github', 'workflows', 'checks.yml'),
    'utf8',
  );
  assert.match(b, /^ {8}run: npm run test:workflows$/m, 'checks.yml から外れている');
  assert.match(
    b,
    /^ {8}if: \$\{\{ !cancelled\(\) \}\}\n {8}run: npm run test:workflows$/m,
    '前段が落ちると走らない形になっている',
  );
});

test('run: | ブロックは 1 つだけ(テストが別のステップを走らせていない)', () => {
  const src = fs.readFileSync(WORKFLOW, 'utf8');
  const count = src.split('\n').filter((l) => /^\s+run: \|\s*$/.test(l)).length;
  // extractRunBlock は最初の 1 つを取る。2 つ目が増えたら、このテストは
  // 意図しないステップを検証していることになる。
  assert.equal(count, 1, `run: | が ${count} 個ある。extractRunBlock の前提が崩れている`);
});
