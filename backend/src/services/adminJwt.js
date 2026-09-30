const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me-in-dev';
const EXPIRES_IN = '8h'; // shorter than the 7d user token — admin sessions are operational, not "stay logged in"

// `type: 'admin'` distinguishes this from a regular User JWT (src/services/jwt.js) so
// a leaked/forged user token can never be replayed against an admin-only endpoint.
function signAdminToken(adminId) {
  return jwt.sign({ sub: adminId, type: 'admin' }, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyAdminToken(token) {
  const payload = jwt.verify(token, SECRET);
  if (payload.type !== 'admin') {
    throw new Error('NOT_AN_ADMIN_TOKEN');
  }
  return payload;
}

module.exports = { signAdminToken, verifyAdminToken };
