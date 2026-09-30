const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me-in-dev';
const EXPIRES_IN = '7d';

function signToken(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws on invalid/expired
}

module.exports = { signToken, verifyToken };
