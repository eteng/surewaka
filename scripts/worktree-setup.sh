#!/usr/bin/env bash
set -euo pipefail

# scripts/worktree-setup.sh
#
# Post-checkout setup for a git worktree. Symlinks local env files from the
# MAIN worktree into the current worktree, then installs dependencies.
#
# Unlike scripts/new-worktree.sh, this script does NOT create the checkout.
# It is meant to run *inside* an already-created worktree — e.g. as Orca's
# `setup` hook (orca.yaml), which runs after Orca has done `git worktree add`.
# It is safe to run manually inside any worktree too.
#
# Env files are symlinked (not copied) so edits to the main worktree's env
# propagate to every worktree.

# Current worktree = repo root of wherever we're running.
DEST=$(git rev-parse --show-toplevel)

# Resolve the MAIN worktree (the first entry of `git worktree list`) to source
# env files from. When run in the main worktree itself, SRC == DEST and we skip.
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

if [[ -z "${MAIN:-}" ]]; then
  echo "Could not resolve main worktree via 'git worktree list'." >&2
  exit 1
fi

echo "Worktree setup"
echo "  main: $MAIN"
echo "  here: $DEST"

link_env_files() {
  # $1 = subdir relative to repo root ("" for root)
  local rel="$1"
  local src_dir="$MAIN${rel:+/$rel}"
  local dest_dir="$DEST${rel:+/$rel}"

  [[ -d "$src_dir" ]] || return 0
  [[ -d "$dest_dir" ]] || return 0

  shopt -s nullglob
  local f name
  # Match .env, .env.local, and .env.*.local — never .env.example (committed).
  for f in "$src_dir"/.env "$src_dir"/.env.local "$src_dir"/.env.*.local; do
    [[ -f "$f" ]] || continue
    name=$(basename "$f")
    # Skip if source and dest are the same path (running in main worktree).
    [[ "$f" -ef "$dest_dir/$name" ]] && continue
    ln -sf "$f" "$dest_dir/$name"
    echo "  linked ${rel:+$rel/}$name"
  done
  shopt -u nullglob
}

# Root-level env files
link_env_files ""

# Per-app env files
APP_DIRS=(
  apps/api
  apps/landing
  apps/admin
  apps/web
  apps/mobile-customer
  apps/mobile-driver
)
for app in "${APP_DIRS[@]}"; do
  link_env_files "$app"
done

echo "Installing dependencies..."
cd "$DEST"
pnpm install --frozen-lockfile || pnpm install

echo ""
echo "Worktree ready at $DEST"
