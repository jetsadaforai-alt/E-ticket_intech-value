#!/usr/bin/env node
// Runs automatically via npm's `pretest` hook: makes sure the dedicated test database
// exists and is migrated up to date, so `npm test` never has to touch the dev database
// (see test/databaseUrl.js for why).
require('dotenv').config();

const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { testDatabaseUrl, maintenanceUrl, databaseNameOf } = require('../test/databaseUrl');

async function main() {
  const targetUrl = testDatabaseUrl();
  const dbName = databaseNameOf(targetUrl);

  const admin = new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });
  try {
    const rows = await admin.$queryRawUnsafe('SELECT 1 FROM pg_database WHERE datname = $1', dbName);
    if (rows.length === 0) {
      // CREATE DATABASE cannot run inside a transaction, and the name comes from our own
      // .env rather than user input, so interpolating it here is safe.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`[test-db] created ${dbName}`);
    }
  } finally {
    await admin.$disconnect();
  }

  // `migrate deploy` is idempotent — it applies only what is missing.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32', // npx is a .cmd on Windows
  });
  console.log(`[test-db] ${dbName} is up to date`);
}

main().catch((err) => {
  console.error('[test-db] failed:', err.message);
  process.exit(1);
});
