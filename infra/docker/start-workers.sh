#!/bin/sh
# Start all workers as background processes.
# If any worker exits, kill all others and exit non-zero (Fly will restart the machine).

set -e

echo "Starting SureWaka workers..."

node workers/email-worker/dist/index.js &
PID_EMAIL=$!

node workers/payment-worker/dist/index.js &
PID_PAYMENT=$!

node workers/agent-worker/dist/index.js &
PID_AGENT=$!

node workers/cron/dist/index.js &
PID_CRON=$!

node workers/push-worker/dist/index.js &
PID_PUSH=$!

node workers/alert-engine/dist/index.js &
PID_ALERT=$!

echo "Workers started: email=$PID_EMAIL payment=$PID_PAYMENT agent=$PID_AGENT cron=$PID_CRON push=$PID_PUSH alert=$PID_ALERT"

# Wait for any process to exit, then kill remaining
wait -n
EXIT_CODE=$?

echo "A worker exited with code $EXIT_CODE — shutting down all workers"
kill $PID_EMAIL $PID_PAYMENT $PID_AGENT $PID_CRON $PID_PUSH $PID_ALERT 2>/dev/null || true
exit $EXIT_CODE
