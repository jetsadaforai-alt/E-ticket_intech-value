const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { requireAdminAuth, requireSuperAdmin } = require('../middleware/adminAuth');

const router = asyncRouter(); // mounted at /v1/packages
const superAdminRouter = asyncRouter(); // mounted at /v1/superadmin/packages
superAdminRouter.use(requireAdminAuth, requireSuperAdmin);

// Prices and caps are stored, not hard-coded, precisely so SuperAdmin can change them
// without a deploy. Everything editable is listed here; anything else is structural.
const EDITABLE_NUMERIC_FIELDS = [
  'priceBaht',
  'eventQuota',
  'ticketPerEvent',
  'eventTopupPrice',
  'ticketTopupPrice',
];

function publicView(pkg) {
  return {
    id: pkg.id,
    code: pkg.code,
    name: pkg.name,
    tier: pkg.tier,
    price_baht: Number(pkg.priceBaht),
    event_quota: pkg.eventQuota,
    ticket_per_event: pkg.ticketPerEvent,
    // Total tickets the package grants, spelled out so the app doesn't have to
    // re-derive the headline number and risk showing something different.
    ticket_total: pkg.eventQuota * pkg.ticketPerEvent,
    event_topup_price: Number(pkg.eventTopupPrice),
    ticket_topup_price: Number(pkg.ticketTopupPrice),
    ticket_topup_bundle_size: pkg.ticketPerEvent,
    topup_enabled: pkg.topupEnabled,
  };
}

// GET /v1/packages — what a vendor can buy right now
router.get('/', requireAuth, async (req, res) => {
  const packages = await prisma.package.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  return res.json(packages.map(publicView));
});

// --- SuperAdmin, mounted at /v1/superadmin/packages ---

// GET /v1/superadmin/packages — includes inactive ones
superAdminRouter.get('/', async (req, res) => {
  const packages = await prisma.package.findMany({ orderBy: { sortOrder: 'asc' } });
  return res.json(
    packages.map((p) => ({
      ...publicView(p),
      is_active: p.isActive,
      updated_at: p.updatedAt,
      updated_by_admin_id: p.updatedByAdminId,
    }))
  );
});

// PATCH /v1/superadmin/packages/:id — edit pricing / quotas
superAdminRouter.patch('/:id', async (req, res) => {
  const body = req.body || {};
  const data = {};

  for (const field of EDITABLE_NUMERIC_FIELDS) {
    if (body[field] === undefined) continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: 'INVALID_VALUE', field });
    }
    // Quotas are counts; prices are money. Only the counts must be whole numbers.
    if ((field === 'eventQuota' || field === 'ticketPerEvent') && !Number.isInteger(value)) {
      return res.status(400).json({ error: 'MUST_BE_INTEGER', field });
    }
    data[field] = value;
  }

  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
  if (typeof body.topupEnabled === 'boolean') data.topupEnabled = body.topupEnabled;
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'NOTHING_TO_UPDATE' });

  data.updatedByAdminId = req.adminId;

  const existing = await prisma.package.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  const updated = await prisma.package.update({ where: { id: req.params.id }, data });

  // Note for whoever reads this next: changing ticketPerEvent does NOT move the
  // ceiling of events that already exist — those carry their own Event.ticketCap
  // snapshot — and changing prices does not touch past receipts, which snapshot
  // their price onto the Purchase row.
  return res.json({ ...publicView(updated), is_active: updated.isActive, updated_at: updated.updatedAt });
});

module.exports = router;
module.exports.superAdminRouter = superAdminRouter;
module.exports.publicView = publicView;
