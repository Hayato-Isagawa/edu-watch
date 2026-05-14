#!/usr/bin/env bash
# Claude Code SessionStart hook — warns when .claude/state/active.md exceeds the size threshold.
# When triggered, the message is injected as additionalContext so Claude reads it at session start.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$REPO_ROOT/.claude/state/active.md"
THRESHOLD=1500

if [ -f "$STATE_FILE" ]; then
  LINES=$(wc -l < "$STATE_FILE" | tr -d ' ')
  if [ "$LINES" -gt "$THRESHOLD" ]; then
    cat <<EOF
⚠️ .claude/state/active.md が ${LINES} 行に到達(しきい値 ${THRESHOLD} 行)。
Lost-in-Multi-Turn の防御ゾーンを超えています。

docs/context-management.md「サイズ管理とアーカイブ運用」セクションの手順で、
古いセッションブロックを .claude/state/archive/ に切り出してください。

目標: 500〜1,000 行(推奨ゾーン)に戻す
EOF
  fi
fi
