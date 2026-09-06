'use strict';

// branch-guard.sh の回帰テスト。
//
// 判定するのは「編集対象ファイルが属する作業ツリー」のブランチであって、
// フック自身の位置(共有チェックアウト)のブランチではない — worktree 内の編集を
// 共有側の main を理由に止めないこと(#508)。同時に、共有側 main 上の編集・
// file_path が取れないときのフォールバック・git 管理外パスが従来どおり止まることも固定する。
//
// フックは一時リポの .claude/hooks/ に複製して実行する。REPO_ROOT がフック自身の位置から
// 決まるので、実リポのフックを直接叩くと判定が実リポの現在ブランチに依存して環境依存になる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK_SRC = path.join(__dirname, '..', 'branch-guard.sh');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout.trim();
}

// 共有チェックアウト(main・1 コミット)と、その worktree(feat/x)を持つ一時リポ。
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-guard-'));
  const shared = path.join(base, 'shared');
  fs.mkdirSync(shared);
  git(shared, 'init', '-q', '-b', 'main');
  // CI ランナーには identity が無い。
  git(shared, 'config', 'user.email', 'test@example.invalid');
  git(shared, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(shared, 'README.md'), 'x\n');
  git(shared, 'add', 'README.md');
  git(shared, 'commit', '-q', '-m', 'init');

  const hooksDir = path.join(shared, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const hook = path.join(hooksDir, 'branch-guard.sh');
  fs.copyFileSync(HOOK_SRC, hook);

  const wt = path.join(base, 'wt');
  git(shared, 'worktree', 'add', '-q', wt, '-b', 'feat/x');
  return { base, shared, hook, wt };
}

function cleanup(f) {
  fs.rmSync(f.base, { recursive: true, force: true });
}

// dispatcher と同じ形で起動する: /bin/bash <hook>、cwd は共有ルート、hook 入力を stdin へ。
function run(f, input) {
  return spawnSync('/bin/bash', [f.hook], { cwd: f.shared, encoding: 'utf8', input });
}

function payload(filePath) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
  });
}

function withFixture(fn) {
  const f = makeFixture();
  try {
    fn(f);
  } finally {
    cleanup(f);
  }
}

test('shared on main + file in shared -> blocked (exit 2)', () => {
  withFixture((f) => {
    const r = run(f, payload(path.join(f.shared, 'README.md')));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'main'/);
  });
});

test('shared on main + existing file in worktree (feat/x) -> allowed (exit 0)', () => {
  withFixture((f) => {
    const r = run(f, payload(path.join(f.wt, 'README.md')));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, '');
  });
});

test('shared on main + new path under a not-yet-existing dir in worktree -> allowed', () => {
  withFixture((f) => {
    const target = path.join(f.wt, 'new', 'deep', 'file.md');
    assert.equal(fs.existsSync(path.dirname(target)), false);
    const r = run(f, payload(target));
    assert.equal(r.status, 0, r.stderr);
  });
});

test('shared on feature branch + file in shared -> allowed', () => {
  withFixture((f) => {
    git(f.shared, 'switch', '-q', '-c', 'feat/y');
    const r = run(f, payload(path.join(f.shared, 'README.md')));
    assert.equal(r.status, 0, r.stderr);
  });
});

test('empty stdin -> falls back to the hook\'s own checkout (main) -> blocked', () => {
  withFixture((f) => {
    const r = run(f, '');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'main'/);
  });
});

test('worktree checked out on master -> blocked (it is the worktree\'s branch that counts)', () => {
  withFixture((f) => {
    const wt2 = path.join(f.base, 'wt-master');
    git(f.shared, 'worktree', 'add', '-q', wt2, '-b', 'master');
    const r = run(f, payload(path.join(wt2, 'README.md')));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'master'/);
  });
});

test('malformed JSON on stdin + worktree path in it -> falls back -> blocked', () => {
  withFixture((f) => {
    const r = run(f, `{"tool_input": {"file_path": "${path.join(f.wt, 'README.md')}"`);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'main'/);
  });
});

test('shared on main + new path under a not-yet-existing dir in shared -> blocked', () => {
  withFixture((f) => {
    const target = path.join(f.shared, 'new', 'deep', 'file.md');
    assert.equal(fs.existsSync(path.dirname(target)), false);
    const r = run(f, payload(target));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'main'/);
  });
});

test('path outside any git repo -> falls back to the hook\'s own checkout (main) -> blocked', () => {
  withFixture((f) => {
    const outside = path.join(f.base, 'outside');
    fs.mkdirSync(outside);
    const r = spawnSync('git', ['-C', outside, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'fixture: outside dir must not be inside a git repo');
    const res = run(f, payload(path.join(outside, 'note.md')));
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /BLOCKED: editing on 'main'/);
  });
});

test('nested git repo created under a tracked dir of shared (main) -> blocked (common dir differs)', () => {
  withFixture((f) => {
    const sub = path.join(f.shared, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'file.md'), 'x\n');
    git(f.shared, 'add', 'sub/file.md');
    git(f.shared, 'commit', '-q', '-m', 'add sub');
    git(sub, 'init', '-q', '-b', 'feat/z');
    const r = run(f, payload(path.join(sub, 'file.md')));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /BLOCKED: editing on 'main'/);
  });
});
