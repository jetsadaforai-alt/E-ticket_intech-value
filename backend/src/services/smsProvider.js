// Pluggable SMS delivery. No real provider account has been set up yet, so this
// is a stub: the caller (services/otp.js) still hands
// back the code in non-production responses so the flow is fully testable without
// a provider. Swap sendSms()'s body for a real provider when credentials exist —
// nothing else in the codebase needs to change.
//
// Example wiring for Twilio, once TWILIO_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM env vars exist:
//   const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
//   async function sendSms(phone, message) {
//     await client.messages.create({ to: phone, from: process.env.TWILIO_FROM, body: message });
//   }

async function sendSms(phone, message) {
  if (process.env.NODE_ENV === 'production') {
    // Fail loudly rather than silently pretend an OTP went out over a channel
    // that doesn't exist — a swallowed error here means a locked-out user with
    // no way to receive their code.
    throw new Error('SMS_PROVIDER_NOT_CONFIGURED');
  }
  console.log(`[dev SMS stub] to ${phone}: ${message}`);
}

module.exports = { sendSms };
