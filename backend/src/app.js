require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Served before the /v1 prefix —
// uploaded event images are static files, not an API resource.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/v1/health', (req, res) => {
  res.json({ status: 'ok' });
});

const authRoutes = require('./routes/auth');
app.use('/v1/auth', authRoutes);
app.use('/v1/me', authRoutes.meRouter);

const vendorRoutes = require('./routes/vendors');
app.use('/v1/vendors', vendorRoutes);
app.use('/v1/admin/vendors', vendorRoutes.adminRouter); // now behind requireAdminAuth (see routes/vendors.js)

// Packages / quota / payments.
// /v1/vendors/me/* sits under the same prefix as vendorRoutes above, which is fine:
// vendorRoutes only declares an exact GET /me and a POST /:id/appeal, so nothing there
// matches /me/quota or /me/purchases and the request falls through to here. Adding a
// /me/:something route to vendors.js later would shadow these — put it here instead.
const packageRoutes = require('./routes/packages');
app.use('/v1/packages', packageRoutes);
app.use('/v1/superadmin/packages', packageRoutes.superAdminRouter);

const purchaseRoutes = require('./routes/purchases');
app.use('/v1/vendors/me', purchaseRoutes);
app.use('/v1/payments', purchaseRoutes.webhookRouter);

const shopRoutes = require('./routes/shops');
app.use('/v1/shops', shopRoutes);
app.use('/v1/staff', shopRoutes.invitationsRouter);

// Chat: customer-scoped routes at /v1/conversations, shop-scoped ones share the
// /v1/shops prefix (mounted after shopRoutes — the paths don't overlap).
const conversationRoutes = require('./routes/conversations');
app.use('/v1/conversations', conversationRoutes);
app.use('/v1/shops', conversationRoutes.shopRouter);

const eventRoutes = require('./routes/events');
app.use('/v1/events', eventRoutes);
app.use('/v1/events', eventRoutes.publicRouter);
app.use('/v1/admin/events', eventRoutes.adminRouter);

// Products: shop-scoped list/create share the /v1/shops prefix, per-product routes get
// their own, and the event↔product link lives under /v1/events. Mounted after eventRoutes
// so its own /:id routes are declared first — the paths don't overlap either way.
const productRoutes = require('./routes/products');
app.use('/v1/products', productRoutes);
app.use('/v1/shops', productRoutes.shopRouter);
app.use('/v1/events', productRoutes.eventRouter);

// Reviews hang off /v1/events/:id/reviews. Mounted after eventRoutes so the plain
// /:id detail route is matched first; the paths are different depths so either order works.
app.use('/v1/events', require('./routes/reviews'));

const ticketRoutes = require('./routes/tickets');
app.use('/v1/tickets', ticketRoutes);
app.use('/v1/share', ticketRoutes.shareClaimRouter);

app.use('/v1/staff', require('./routes/staffScan'));
app.use('/v1/notifications', require('./routes/notifications'));

app.use('/v1/admin/auth', require('./routes/adminAuth'));
app.use('/v1/admin/me', require('./routes/adminMe'));

const supportRoutes = require('./routes/adminSupport');
app.use('/v1/admin/support-tickets', supportRoutes);
app.use('/v1/support-tickets', supportRoutes.userRouter);

app.use('/v1/superadmin/admins', require('./routes/superAdmin'));
app.use('/v1/superadmin/dashboard', require('./routes/superAdminDashboard'));

app.use('/v1/admin/users', require('./routes/adminUsers'));

// Without this, a middleware-level failure (multer rejecting an oversized file or an
// unexpected field name, say) falls through to Express's default handler and returns
// an HTML page — which the mobile client can't parse, so the real reason was lost.
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.code, field: err.field });
  }
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
});

module.exports = app;
