#!/usr/bin/env bash
# Claude Code PreToolUse hook — block Edit/Write/MultiEdit on main/master.
# Forces work onto a feature branch so PR-driven workflow stays intact.
#
# 判定するブランチは「編集対象ファイルが属する作業ツリー」のもの。フック自身の位置
# (共有チェックアウト)ではない。git worktree の中を編集しているとき、共有側が main に
# いても worktree 側が feature ブランチなら通す(edu-evidence #508)。
# file_path が取れない / 解析できない / このリポの作業ツリーでない(git 管理外・別リポ・
# 追跡下に作られた nested repo)ときは従来どおり共有側で判定する
# (新しい経路が壊れても今より緩くはならない)。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# stdin の hook 入力(JSON)から tool_input.file_path を取る。取れなければ空。
# JSON の解析は node に任せる(sed 抽出は引用符やエスケープで壊れる)。
file_path=""
if [ ! -t 0 ]; then
  payload="$(cat 2>/dev/null || true)"
  if [ -n "$payload" ] && command -v node >/dev/null 2>&1; then
    file_path="$(printf '%s' "$payload" | node -e '
      let d = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => { d += c; });
      process.stdin.on("end", () => {
        let p = "";
        try { p = String(JSON.parse(d)?.tool_input?.file_path ?? ""); } catch {}
        process.stdout.write(p);
      });
    ' 2>/dev/null || true)"
  fi
fi

# 判定ディレクトリ = file_path の存在する最も近い祖先(新規作成ではファイル自身はまだ無い)。
target=""
if [ -n "$file_path" ]; then
  case "$file_path" in
    /*) ;;
    *) file_path="$PWD/$file_path" ;;
  esac
  dir="$(dirname "$file_path")"
  while [ ! -d "$dir" ] && [ "$dir" != "/" ]; do
    dir="$(dirname "$dir")"
  done
  if [ -d "$dir" ]; then
    target="$dir"
  fi
fi

# target がこのリポの作業ツリー(worktree を含む)に属するか = git common dir が一致するか。
# 一致しないのは git 管理外・別リポ・追跡下に作られた nested repo で、いずれも共有側で判定する
# (nested repo のブランチで判定すると main 上の編集が通ってしまう)。
same_repo() {
  local a b
  a="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  b="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  a="$(cd "$a" 2>/dev/null && pwd -P)" || return 1
  b="$(cd "$b" 2>/dev/null && pwd -P)" || return 1
  [ "$a" = "$b" ]
}

branch=""
if [ -n "$target" ] && same_repo "$target"; then
  branch="$(git -C "$target" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [ -z "$branch" ]; then
  if ! branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null); then
    exit 0
  fi
fi

case "$branch" in
  main|master)
    {
      echo "[branch-guard] BLOCKED: editing on '$branch' is forbidden."
      echo "[branch-guard] Create a feature branch first:"
      echo "    git fetch origin && git switch -c <type>/<short-description> --no-track origin/main"
      echo "[branch-guard] Examples: feat/sprint-2-batch-2, fix/parser-edge-case, chore/deps-bump"
    } >&2
    exit 2
    ;;
esac

exit 0
