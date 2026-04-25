#!/usr/bin/env bash
# Claude Code PostCompact hook — fires after context compaction.
# Reminds the assistant to re-read the living checkpoint file so that
# file-backed state is reloaded into fresh context.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.claude/state/active.md"

echo "=== Context Restored After Compaction ==="

if [ -f "$STATE_FILE" ]; then
  LINES=$(wc -l < "$STATE_FILE" | tr -d ' ')
  echo "Session state file: .claude/state/active.md ($LINES lines)"
  echo "IMPORTANT: Read this file now to restore your working context."
  echo "It contains the current task, recent decisions, and open questions."
else
  echo "No session state file at .claude/state/active.md."
  echo "Check docs/decisions/ for recent ADRs and git log for context."
fi

echo "Also check: docs/context-management.md (file-backed state policy)"
echo "==========================================="
