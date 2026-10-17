#!/usr/bin/env bash
# push-to-branch.sh <branch> <dir>
# Replaces the content of <branch> with the files in <dir> (one commit, force-pushed)
# without touching the current checkout. Used for screenshots and diagnostics.
set -euo pipefail
branch=$1; dir=$2
export GIT_INDEX_FILE=$(mktemp); rm -f "$GIT_INDEX_FILE"
( cd "$dir" && find . -type f | sed 's#^\./##' ) | while read -r f; do
  blob=$(git hash-object -w "$dir/$f")
  git update-index --add --cacheinfo 100644,"$blob","$f"
done
tree=$(git write-tree)
commit=$(GIT_AUTHOR_NAME=ci GIT_AUTHOR_EMAIL=ci@localhost GIT_COMMITTER_NAME=ci GIT_COMMITTER_EMAIL=ci@localhost \
  git commit-tree "$tree" -m "$branch from $(git rev-parse --short HEAD) at $(date -u +%FT%TZ)")
rm -f "$GIT_INDEX_FILE"
git push -q -f origin "$commit:refs/heads/$branch"
echo "Pushed $dir to branch $branch"
