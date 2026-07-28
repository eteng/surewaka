#!/usr/bin/env bash
# Exposes the local API on a static ngrok domain so Paystack (and other
# webhook senders) can reach POST /api/v1/webhook/paystack during dev.
# No-ops cleanly if ngrok isn't installed or NGROK_DOMAIN isn't set, so
# `pnpm dev` still works for anyone who hasn't set this up.
set -euo pipefail

# concurrently spawns this directly (not through tsx --env-file), so load
# the same env files the API process uses.
set -a
[ -f ../../.env ] && source ../../.env
[ -f .env ] && source .env
set +a

PORT="${PORT:-4000}"

if ! command -v ngrok &> /dev/null; then
  echo "[tunnel] ngrok not installed — skipping. Install: https://ngrok.com/download"
  exit 0
fi

if [ -z "${NGROK_DOMAIN:-}" ]; then
  echo "[tunnel] NGROK_DOMAIN not set — skipping. Reserve a free static domain at https://dashboard.ngrok.com/domains and set NGROK_DOMAIN in .env"
  exit 0
fi

echo "[tunnel] Paystack webhook URL: https://${NGROK_DOMAIN}/api/v1/webhook/paystack"
echo "[tunnel] Set this once in the Paystack dashboard under Settings > API Keys & Webhooks"

exec ngrok http --url="https://${NGROK_DOMAIN}" "${PORT}"
