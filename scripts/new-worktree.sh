#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/new-worktree.sh <branch-name>
# Creates a git worktree at .worktrees/<branch-name>, installs deps,
# and symlinks all local env files from the root and each app.

BRANCH=${1:-}
if [[ -z "$BRANCH" ]]; then
  echo "Usage: $0 <branch-name>"
  echo "  e.g. $0 feat/push-notifications"
  exit 1
fi

ROOT=$(git rev-parse --show-toplevel)
DEST="$ROOT/.worktrees/$BRANCH"

if [[ -d "$DEST" ]]; then
  echo "Worktree already exists at $DEST"
  exit 1
fi

echo "Creating worktree: $DEST on branch $BRANCH"
git worktree add "$DEST" -b "$BRANCH"

# Symlink root-level env files
for f in .env .env.local .env.*.local; do
  if [[ -f "$ROOT/$f" ]]; then
    ln -s "$ROOT/$f" "$DEST/$f"
    echo "  linked $f"
  fi
done

# Symlink per-app env files
APP_DIRS=(
  apps/api
  apps/landing
  apps/admin
  apps/web
  apps/mobile-customer
  apps/mobile-driver
)

for app in "${APP_DIRS[@]}"; do
  src_dir="$ROOT/$app"
  dest_dir="$DEST/$app"

  if [[ ! -d "$src_dir" ]]; then
    continue
  fi

  for f in .env .env.local .env.*.local; do
    if [[ -f "$src_dir/$f" ]]; then
      ln -sf "$src_dir/$f" "$dest_dir/$f"
      echo "  linked $app/$f"
    fi
  done
done

echo "Installing dependencies..."
cd "$DEST"
pnpm install --frozen-lockfile

echo ""
echo "Worktree ready at $DEST"
echo "  cd $DEST"
echo "  claude"
