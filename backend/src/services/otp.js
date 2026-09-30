const crypto = require('crypto');
const { getRedis } = require('./redisClient');
const { sendSms } = require('./smsProvider');

// Business rules:
// - resend cooldown: 60s
// - lockout after 5 wrong verify attempts
const OTP_TTL_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// `key` namespaces the Redis state (e.g. a raw phone for User login, or
// `admin:<phone>` for Admin login so the two flows can never collide even if a
// user and an admin happen to share a phone number — see routes/adminAuth.js).
// `destinationPhone` is the real number sendSms() delivers to; it defaults to
// `key` for the common case where they're the same value.
async function requestOtp(key, destinationPhone = key) {
  const redis = await getRedis();

  const locked = await redis.get(`otp:lockout:${key}`);
  if (locked) {
    const err = new Error('LOCKED_OUT');
    err.code = 'LOCKED_OUT';
    throw err;
  }

  const cooldown = await redis.get(`otp:cooldown:${key}`);
  if (cooldown) {
    const err = new Error('COOLDOWN_ACTIVE');
    err.code = 'COOLDOWN_ACTIVE';
    throw err;
  }

  const code = generateCode();
  await redis.set(`otp:code:${key}`, hashCode(code), { EX: OTP_TTL_SECONDS });
  await redis.set(`otp:cooldown:${key}`, '1', { EX: RESEND_COOLDOWN_SECONDS });
  await redis.del(`otp:attempts:${key}`);

  // No real SMS provider account exists yet — smsProvider.js is a stub that
  // logs instead of sending. In dev we also return the code directly so the flow
  // is testable end-to-end without a provider; that devCode must never ship to
  // a production response (smsProvider.js enforces this by throwing instead of
  // silently no-op'ing when NODE_ENV=production).
  await sendSms(destinationPhone, `รหัส OTP ของคุณคือ ${code} (หมดอายุใน 5 นาที)`);
  const devCode = process.env.NODE_ENV === 'production' ? undefined : code;
  return { devCode };
}

async function verifyOtp(key, code) {
  const redis = await getRedis();

  const locked = await redis.get(`otp:lockout:${key}`);
  if (locked) {
    const err = new Error('LOCKED_OUT');
    err.code = 'LOCKED_OUT';
    throw err;
  }

  const storedHash = await redis.get(`otp:code:${key}`);
  if (!storedHash) {
    const err = new Error('OTP_EXPIRED_OR_NOT_REQUESTED');
    err.code = 'OTP_EXPIRED_OR_NOT_REQUESTED';
    throw err;
  }

  if (storedHash !== hashCode(code)) {
    const attempts = await redis.incr(`otp:attempts:${key}`);
    await redis.expire(`otp:attempts:${key}`, OTP_TTL_SECONDS);
    if (attempts >= MAX_ATTEMPTS) {
      await redis.set(`otp:lockout:${key}`, '1', { EX: LOCKOUT_SECONDS });
      await redis.del(`otp:code:${key}`);
      const err = new Error('LOCKED_OUT');
      err.code = 'LOCKED_OUT';
      throw err;
    }
    const err = new Error('INVALID_CODE');
    err.code = 'INVALID_CODE';
    throw err;
  }

  await redis.del(`otp:code:${key}`);
  await redis.del(`otp:attempts:${key}`);
  await redis.del(`otp:cooldown:${key}`);
  return true;
}

module.exports = { requestOtp, verifyOtp };
