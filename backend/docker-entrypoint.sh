#!/bin/sh
# All three steps are idempotent (migrate deploy + upsert-style seeds), so this is safe to run
# on every container start, not just the first one.
set -e

npx prisma migrate deploy
npm run seed

# seedDemoData.js drives the real HTTP API (see backend/scripts/seedDemoData.js),
# so the server has to be up first — start it in the background and wait for
# /v1/health before seeding, then hand off to it as the container's main process.
node src/index.js &
server_pid=$!

echo "Waiting for backend to become healthy before seeding demo data..."
until curl -sf http://localhost:3000/v1/health >/dev/null 2>&1; do
  sleep 1
done

# SEED_DEMO_DATA=false (set on the VM for real testing) keeps the demo shops/events
# from being recreated on every restart. Default true: local dev behaves as before.
if [ "${SEED_DEMO_DATA:-true}" != "false" ]; then
  npm run seed:demo
else
  echo "Skipping demo data (SEED_DEMO_DATA=false)"
fi

wait "$server_pid"
