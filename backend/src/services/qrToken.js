const crypto = require('crypto');
const { getRedis } = require('./redisClient');

// The token rotates every 60s so a screenshot
// stops working once it expires. We issue a fresh token on every request rather
// than tracking a single "current" token per ticket — simple, and the anti-fraud
// property comes from the ticket-status check at scan time, not from token uniqueness.
const TTL_SECONDS = 60;

async function issueToken(ticketId) {
  const redis = await getRedis();
  const token = crypto.randomBytes(16).toString('hex');
  await redis.set(`qrtoken:${token}`, ticketId, { EX: TTL_SECONDS });
  return { token, expiresInSeconds: TTL_SECONDS };
}

async function resolveToken(token) {
  const redis = await getRedis();
  return redis.get(`qrtoken:${token}`);
}

module.exports = { issueToken, resolveToken };
