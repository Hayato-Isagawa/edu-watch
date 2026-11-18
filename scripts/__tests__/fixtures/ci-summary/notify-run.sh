set -euo pipefail

runs=$(gh api --paginate "repos/${GH_REPO}/commits/${SHA}/check-runs" \
  --jq '.check_runs[] | select(.app.slug == "github-actions") | [.name, .status, .conclusion] | @tsv' \
  | { grep -v -F "$SELF" || true; })

if [ -z "$runs" ]; then
  echo "no Actions check-runs on ${SHA}; nothing to do"
  exit 0
fi
printf '%s\n' "$runs"

if printf '%s\n' "$runs" | awk -F'\t' '$2 != "completed" { found = 1 } END { exit !found }'; then
  echo "some checks are still running; a later completion will re-evaluate"
  exit 0
fi
# skipped は許容する。人間の PR では Dependabot auto-merge の job が skipped になる。
if printf '%s\n' "$runs" | awk -F'\t' '$3 != "success" && $3 != "skipped" && $3 != "neutral" { found = 1 } END { exit !found }'; then
  echo "some checks did not succeed; not notifying"
  exit 0
fi

pr="${PR_FROM_EVENT}"
if [ -z "$pr" ]; then
  pr=$(gh api "repos/${GH_REPO}/commits/${SHA}/pulls" --jq '.[0].number // empty')
fi
if [ -z "$pr" ]; then
  echo "no pull request found for ${SHA}; nothing to do"
  exit 0
fi

# 一度変数に受け、パイプを使わずに探す。`gh ... | grep -q` だと、grep が先に抜けたときの
# SIGPIPE や API エラーが pipefail で「未投稿」と読まれ、二重投稿になる(printf | grep でも同じ)。
# 照合するのは github-actions[bot] のコメントだけ。公開リポなので、誰かが印を先に書けば
# 通知を止められてしまう。
marker="<!-- ci-summary: ${SHA} -->"
comments=$(gh api --paginate "repos/${GH_REPO}/issues/${pr}/comments" --jq '.[] | select(.user.login == "github-actions[bot]") | .body')
if [[ "$comments" == *"$marker"* ]]; then
  echo "already commented on #${pr} for ${SHA}"
  exit 0
fi

# REST で投稿する(pull-requests: write で足りることが権限表で確認できる経路)
gh api "repos/${GH_REPO}/issues/${pr}/comments" \
  -f body="✅ CI 全件成功（${SHA:0:7}）@Hayato-Isagawa"$'\n'"${marker}" > /dev/null
