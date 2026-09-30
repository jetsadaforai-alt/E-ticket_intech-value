const crypto = require('crypto');

/**
 * Stand-in gateway for development and for the demo.
 *
 * It creates a charge and hands back a fake PromptPay-style payload, but it never
 * marks anything paid on its own: the client has to call back through the same webhook
 * a real gateway would use. Keeping that round trip honest is the point — it means the
 * "grant quota" path is exercised exactly as it will be in production, instead of
 * working only in a shortcut that gets deleted on the way to a real provider.
 */

const CHARGE_TTL_MINUTES = 15;

/** @type {import('./index').PaymentProvider} */
const mockProvider = {
  name: 'mock',

  async createCharge({ purchaseId, amountBaht, metadata = {} }) {
    const providerRef = `mock_${crypto.randomUUID()}`;
    return {
      providerRef,
      status: 'pending',
      expiresAt: new Date(Date.now() + CHARGE_TTL_MINUTES * 60_000),
      payload: {
        kind: 'promptpay_qr',
        // Not a scannable payload — a real provider returns an EMVCo string here.
        qr_data: `MOCKPAY|${providerRef}|${Number(amountBaht).toFixed(2)}`,
        amount_baht: Number(amountBaht).toFixed(2),
        // The client shows a "confirm payment" button in dev that posts this back to
        // /v1/payments/webhook, standing in for the bank's callback.
        dev_confirm: { provider: 'mock', provider_ref: providerRef, status: 'succeeded' },
        purchase_id: purchaseId,
        ...metadata,
      },
    };
  },

  async verifyCallback(req) {
    const { provider_ref: providerRef, status } = req.body || {};
    if (!providerRef) return null; // nothing to act on — caller answers 400

    // A real provider verifies an HMAC signature over the raw body here. The mock has
    // no secret to check, which is exactly why it must never be the configured
    // provider outside development (see index.js).
    return {
      providerRef,
      status: status === 'succeeded' ? 'succeeded' : 'failed',
    };
  },
};

module.exports = { mockProvider };
