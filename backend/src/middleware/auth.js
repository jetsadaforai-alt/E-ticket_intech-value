const { verifyToken } = require('../services/jwt');
const prisma = require('../services/prismaClient');

// Loads the caller's status on every request rather than trusting the JWT alone, so a
// suspension takes effect on the very next request instead of waiting up to 7 days for
// the token to expire naturally — there is no refresh token or revocation store.
// This mirrors requireAdminAuth (middleware/adminAuth.js), which
// already does the same DB lookup for admin accounts.
//
// This function is async and can reject (the Prisma call can throw). It is never used
// directly on an app.use() — every route file that imports requireAuth/
// requireAuthAllowSuspended builds its router with asyncRouter() (src/lib/asyncRouter.js),
// which wraps *every* argument passed to a route registration, including middleware
// functions like this one, and pipes a rejection to next() automatically. So a manual
// try/catch here is redundant, not missing — see lib/asyncRouter.js for why that
// wrapping exists in the first place.
async function loadCaller(req, res) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true },
  });
  if (!user) {
    res.status(401).json({ error: 'USER_NOT_FOUND' });
    return null;
  }
  return user;
}

// The default for almost every endpoint: a suspended account is blocked outright.
async function requireAuth(req, res, next) {
  const user = await loadCaller(req, res);
  if (!user) return; // loadCaller already sent the response
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
  }
  req.userId = user.id;
  next();
}

// Lets a suspended account through. Reserved for the appeal channel only — GET/PATCH
// /v1/me (so the app can render the suspension screen and its reason), POST/GET
// /v1/support-tickets (the appeal channel itself), and /v1/notifications (so the reason
// is readable there too, since the suspension notification lives in that list). Anything
// not explicitly wired to this must use requireAuth instead: the default is "blocked",
// not "allowed" — a router that forgets to think about this stays locked out rather than
// silently open.
async function requireAuthAllowSuspended(req, res, next) {
  const user = await loadCaller(req, res);
  if (!user) return;
  req.userId = user.id;
  req.userStatus = user.status;
  next();
}

// For routes that must stay guest-accessible (e.g. GET /v1/events/:id) but want to
// personalize the response when the caller happens to be logged in. Never blocks the
// request — a missing, malformed, expired, or unknown-user token all just fall through
// as a guest (req.userId left unset), same as sending no Authorization header at all.
async function attachCallerIfPresent(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next();

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, status: true } });
    if (user && user.status === 'active') req.userId = user.id;
  } catch {
    // invalid/expired token on a guest-accessible route — proceed as guest, don't 401
  }
  next();
}

module.exports = { requireAuth, requireAuthAllowSuspended, attachCallerIfPresent };
