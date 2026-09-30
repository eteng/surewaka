#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/new-worktree.sh <branch-name>
# Creates a git worktree at .worktrees/<branch-name>, then runs the shared
# setup (env symlinks + pnpm install) via scripts/worktree-setup.sh.
#
# For Orca-managed worktrees, Orca performs the checkout itself and runs
# scripts/worktree-setup.sh directly through the orca.yaml `setup` hook
# (pnpm worktree:setup). This script is the manual, non-Orca entry point.

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

# Delegate env symlinking + dependency install to the shared setup script,
# run from inside the new worktree so it resolves the main worktree correctly.
( cd "$DEST" && bash "$ROOT/scripts/worktree-setup.sh" )

echo ""
echo "Worktree ready at $DEST"
echo "  cd $DEST"
echo "  claude"
