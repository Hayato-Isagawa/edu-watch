#!/usr/bin/env bash
# Claude Code PreCompact hook — dumps session state before context compaction.
# Output appears in the conversation right before the summarizer runs, so
# critical state survives the summarization.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.claude/state/active.md"

echo "=== SESSION STATE BEFORE COMPACTION ==="
echo "Timestamp: $(date -Iseconds)"
echo ""

# --- active.md (living checkpoint) ---
if [ -f "$STATE_FILE" ]; then
  echo "## Active Session State (.claude/state/active.md)"
  STATE_LINES=$(wc -l < "$STATE_FILE" | tr -d ' ')
  if [ "$STATE_LINES" -gt 120 ]; then
    head -n 120 "$STATE_FILE"
    echo ""
    echo "... (truncated — $STATE_LINES total lines, showing first 120)"
  else
    cat "$STATE_FILE"
  fi
else
  echo "## No active.md found"
  echo "Consider maintaining .claude/state/active.md as a living checkpoint."
  echo "See docs/context-management.md for the rationale."
fi

# --- git working tree ---
echo ""
echo "## Git Working Tree"

if git -C "$REPO_ROOT" rev-parse --git-dir > /dev/null 2>&1; then
  BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo "Branch: $BRANCH"

  CHANGED=$(git -C "$REPO_ROOT" diff --name-only 2>/dev/null)
  STAGED=$(git -C "$REPO_ROOT" diff --staged --name-only 2>/dev/null)
  UNTRACKED=$(git -C "$REPO_ROOT" ls-files --others --exclude-standard 2>/dev/null)

  if [ -n "$CHANGED" ]; then
    echo ""
    echo "Unstaged changes:"
    echo "$CHANGED" | sed 's/^/  - /'
  fi
  if [ -n "$STAGED" ]; then
    echo ""
    echo "Staged changes:"
    echo "$STAGED" | sed 's/^/  - /'
  fi
  if [ -n "$UNTRACKED" ]; then
    echo ""
    echo "Untracked files:"
    echo "$UNTRACKED" | sed 's/^/  - /'
  fi
  if [ -z "$CHANGED" ] && [ -z "$STAGED" ] && [ -z "$UNTRACKED" ]; then
    echo "  (no uncommitted changes)"
  fi

  echo ""
  echo "Recent commits:"
  git -C "$REPO_ROOT" log --oneline -n 5 2>/dev/null | sed 's/^/  /'
else
  echo "  (not a git repo)"
fi

echo ""
echo "=== END ==="
