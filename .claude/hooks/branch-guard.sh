#!/usr/bin/env bash
# Claude Code PreToolUse hook — block Edit/Write/MultiEdit on main/master.
# Forces work onto a feature branch so PR-driven workflow stays intact.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null); then
  exit 0
fi

case "$branch" in
  main|master)
    {
      echo "[branch-guard] BLOCKED: editing on '$branch' is forbidden."
      echo "[branch-guard] Create a feature branch first:"
      echo "    git checkout -b <type>/<short-description>"
      echo "[branch-guard] Examples: feat/sprint-2-batch-2, fix/parser-edge-case, chore/deps-bump"
    } >&2
    exit 2
    ;;
esac

exit 0
