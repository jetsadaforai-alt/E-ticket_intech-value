const { mockProvider } = require('./mockProvider');

/**
 * The seam a real payment gateway plugs into.
 *
 * Payment is designed as a swappable interface rather than wired to one vendor, so nothing outside this folder knows which gateway
 * is in use — routes only ever talk to the object `getProvider()` returns.
 *
 * Adding PromptPay or a card processor means writing one more file here that satisfies
 * the shape below and registering it in PROVIDERS; no route changes.
 *
 * @typedef {object} Charge
 * @property {string}  providerRef  gateway's id for this charge — also our webhook idempotency key
 * @property {'pending'|'succeeded'|'failed'} status
 * @property {Date}   [expiresAt]
 * @property {object} [payload]     whatever the client needs to render (QR string, redirect URL…)
 *
 * @typedef {object} PaymentProvider
 * @property {string} name
 * @property {(input: { purchaseId: string, amountBaht: number|string, metadata?: object }) => Promise<Charge>} createCharge
 * @property {(req: import('express').Request) => Promise<{ providerRef: string, status: 'succeeded'|'failed' }|null>} verifyCallback
 *   Must authenticate the request (signature/HMAC) before returning anything.
 *   Returning null means "not a request we recognise".
 */

const PROVIDERS = {
  mock: mockProvider,
};

function getProvider() {
  const name = process.env.PAYMENT_PROVIDER || 'mock';
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown PAYMENT_PROVIDER "${name}" — known: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  // The mock accepts any callback as genuine, so letting it run in production would
  // hand out quota to anyone who can POST to the webhook. Fail loudly at startup
  // instead of silently, the same way smsProvider.js refuses to no-op in production.
  if (name === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_PROVIDER=mock cannot run in production — it does not verify callbacks');
  }
  return provider;
}

module.exports = { getProvider };
