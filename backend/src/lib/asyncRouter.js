const express = require('express');

/**
 * Express 4 does not forward a rejected promise from an `async` handler.
 * The error middleware in `src/app.js` therefore never sees it, and — worse — the
 * request simply hangs with no response at all: the mobile client's `fetch` neither
 * resolves nor rejects, so the UI spins forever with no error to show. On Node 24 the
 * unhandled rejection also kills the process outright, which under `node --watch`
 * looks like a silent restart that drops every in-flight request.
 *
 * That is what hid the real cause of the broken event-image upload for a whole round
 * of debugging: an unrelated chat endpoint threw every 30 seconds and took the server
 * with it.
 *
 * Rather than adding try/catch to all 56 handlers, routers are built here instead of
 * with `express.Router()`, and every handler registered on them gets its rejection
 * piped to `next()`.
 *
 * Express 5 does this natively, but its `req.query` and path-to-regexp changes are too
 * risky to take mid-project.
 */

const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function wrap(handler) {
  if (Array.isArray(handler)) return handler.map(wrap);
  // Paths (strings, RegExp) and anything else non-callable pass straight through, which
  // is what lets this map over every argument regardless of the call signature.
  if (typeof handler !== 'function') return handler;
  // A 4-arg handler is error middleware — wrapping it would change its arity and
  // Express would stop routing errors to it.
  if (handler.length >= 4) return handler;
  // A mounted sub-router is itself a 3-arg function; leave it as the router object so
  // Express keeps its own dispatch and mount behaviour. Its handlers are already
  // wrapped, because that router was built by this same factory.
  if (Array.isArray(handler.stack)) return handler;

  return function asyncWrapped(req, res, next) {
    // A synchronous throw already reaches Express on its own; this only covers the
    // async case. `Promise.resolve` handles handlers that return nothing just as well.
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function asyncRouter(options) {
  const router = express.Router(options);

  for (const method of ROUTE_METHODS) {
    const original = router[method].bind(router);
    // Every argument is mapped rather than assuming `(path, ...handlers)`, because
    // `use()` is just as often called as `use(middleware)` with no path at all.
    router[method] = (...args) => original(...args.map(wrap));
  }

  return router;
}

module.exports = { asyncRouter };
