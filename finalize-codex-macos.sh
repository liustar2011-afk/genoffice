#!/usr/bin/env bash
set -euo pipefail

branch="$(git branch --show-current)"
if [[ "$branch" != "codex-v1" ]]; then
  echo "Run this from branch codex-v1 (current: $branch)." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo 'Working tree must be clean before finalizing Codex V1.' >&2
  exit 1
fi

bash ./setup-codex-macos.sh

git add -A
if git diff --cached --quiet; then
  echo 'No generated Codex changes to commit.'
  exit 0
fi

git commit -m 'feat: flatten Codex V1 integration'
git push origin codex-v1

echo 'Codex V1 source changes were committed and pushed to origin/codex-v1.'
