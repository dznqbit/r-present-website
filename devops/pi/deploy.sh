#!/usr/bin/env bash
# Update the admin on the Pi to the latest main and restart it.
# Run on the Pi:  /srv/r-present/repo/devops/pi/deploy.sh
set -euo pipefail
export PATH=/opt/node/bin:$PATH
REPO=/srv/r-present/repo

CONTENT=apps/r-present-website/src/content
PUBLISHED=refs/r-present-admin/published

cd "$REPO"

# The admin publishes on the side, so this checkout's own commit and index lag
# behind what's live. Compare content against the admin's "published" commit
# through a throwaway index instead.
content_changes() {
  local idx
  idx=$(mktemp)
  GIT_INDEX_FILE=$idx git read-tree "$PUBLISHED"
  GIT_INDEX_FILE=$idx git add --all -- "$CONTENT"
  GIT_INDEX_FILE=$idx git diff --cached --name-status "$PUBLISHED" -- "$CONTENT"
  rm -f "$idx"
}

if git rev-parse --verify --quiet "$PUBLISHED" >/dev/null; then
  # Refuse to deploy over unpublished admin edits: they'd be easy to lose.
  drafts=$(content_changes)
  if [ -n "$drafts" ]; then
    echo "Stopped: the admin has unpublished changes:" >&2
    echo "$drafts" >&2
    echo "Publish them or click Discard in the admin, then run this again." >&2
    exit 1
  fi
  # Content matches what's published (and so is on GitHub). Put the files back
  # to this checkout's commit so `git pull` doesn't trip over them; if the pull
  # fails, restore the published content.
  git restore --source=HEAD --worktree -- "$CONTENT"
  git clean --force --quiet -- "$CONTENT"
  if ! git pull --ff-only; then
    git restore --source="$PUBLISHED" --worktree -- "$CONTENT"
    echo "git pull failed; content restored to what's published." >&2
    exit 1
  fi
else
  git pull --ff-only
fi

# Content now matches this commit, so that's the new "published" baseline.
# (The next Publish pulls down anything newer from GitHub.)
git update-ref "$PUBLISHED" HEAD

echo "== website deps (astro sync, prettier, preview builds)"
(cd apps/r-present-website && npm ci --no-audit --no-fund)
# Regenerate the content schemas the admin's forms are built from, so new or
# changed fields show up after the restart below.
(cd apps/r-present-website && npx astro sync)

echo "== backend"
(cd apps/r-present-admin-backend && npm ci --no-audit --no-fund && npm run build)

echo "== admin SPA"
(cd apps/r-present-admin && npm ci --no-audit --no-fund && npm run build)

sudo systemctl restart r-present-admin-backend
echo "Deployed $(git rev-parse --short HEAD)"
