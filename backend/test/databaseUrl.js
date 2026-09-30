/**
 * Tests run against a dedicated database, never the one `npm run dev` uses.
 *
 * `wipeDatabase()` deletes every row in every table, and for a long time it did that
 * to the shared dev database — so a single `npm test` erased whatever vendors, shops
 * and events had been created by hand, and logged you out by taking `AdminAccount`
 * with it. Deriving a separate URL here removes that trap
 * entirely rather than documenting it.
 *
 * Set `TEST_DATABASE_URL` to point somewhere else; otherwise the dev database name
 * gets a `_test` suffix on the same server.
 */
function testDatabaseUrl(devUrl = process.env.DATABASE_URL) {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!devUrl) throw new Error('DATABASE_URL is not set — check backend/.env');

  const url = new URL(devUrl);
  // pathname is "/<dbname>"; an empty one would silently target the default database.
  if (url.pathname.length <= 1) throw new Error(`DATABASE_URL has no database name: ${devUrl}`);
  if (url.pathname.endsWith('_test')) return url.toString(); // already a test URL
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Same server, but the `postgres` maintenance database — the only place CREATE DATABASE can run. */
function maintenanceUrl(devUrl = process.env.DATABASE_URL) {
  const url = new URL(devUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function databaseNameOf(connectionUrl) {
  return new URL(connectionUrl).pathname.slice(1);
}

module.exports = { testDatabaseUrl, maintenanceUrl, databaseNameOf };
