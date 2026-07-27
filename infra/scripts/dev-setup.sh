#!/bin/bash
# SureWaka development environment setup

set -e

echo "🚀 Setting up SureWaka development environment..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "📦 Installing pnpm..."; corepack enable && corepack prepare pnpm@9.15.0 --activate; }
command -v docker >/dev/null 2>&1 || { echo "⚠️  Docker not found. You'll need it for local databases."; }

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Copy environment files
if [ ! -f .env.local ]; then
  echo "📝 Creating .env.local..."
  cp .env.example .env.local
  echo "⚠️  Update .env.local with your API keys"
fi

# Start local services
if command -v docker >/dev/null 2>&1; then
  echo "🐳 Starting local services (Postgres, Redis)..."
  docker compose -f infra/docker/docker-compose.yml up -d
fi

# Run database migrations
echo "🗄️  Running database migrations..."
pnpm --filter @surewaka/db db:push

echo ""
echo "✅ Setup complete! Run 'pnpm dev' to start all services."
echo ""
echo "Services:"
echo "  Web app:        http://localhost:3000"
echo "  Admin:          http://localhost:3001"
echo "  Landing:        http://localhost:3002"
echo "  API:            http://localhost:4000"
echo "  Postgres:       localhost:5432"
echo "  Redis:          localhost:6379"
echo ""
echo "Workers (started by 'pnpm dev'):"
echo "  push-worker:    BullMQ consumer (health: :4001)"
echo "  payment-worker: BullMQ consumer"
echo "  routing-worker: BullMQ consumer (health: :4003)"
echo "  alert-engine:   BullMQ consumer"
echo "  agent-worker:   BullMQ consumer"
echo "  email-worker:   BullMQ consumer"
echo "  cron:           Scheduled jobs"
echo ""
echo "Health checks:"
echo "  curl http://localhost:4000/health   # API"
echo "  curl http://localhost:4001/health   # Push worker"
echo "  curl http://localhost:4003/health   # Routing worker"
