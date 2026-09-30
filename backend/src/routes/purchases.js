const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { getProvider } = require('../services/payment');
const {
  getVendorQuota,
  creditQuota,
  applyTicketTopupToEvent,
  describePurchase,
  REASON,
} = require('../services/quota');

const router = asyncRouter(); // mounted at /v1/vendors/me
const webhookRouter = asyncRouter(); // mounted at /v1/payments

const PURCHASE_TYPES = new Set(['package', 'event_topup', 'ticket_topup']);
const MAX_TOPUP_QUANTITY = 50; // a sane ceiling; nobody buys 10k event slots by accident

/** Resolves the caller's vendor, or null if they don't own one. */
async function ownedVendorId(userId) {
  const ownership = await prisma.vendorOwnership.findFirst({ where: { userId } });
  return ownership ? ownership.vendorId : null;
}

function purchaseView(purchase) {
  return {
    id: purchase.id,
    type: purchase.type,
    package_code: purchase.packageCodeSnapshot,
    unit_price_baht: Number(purchase.unitPriceSnapshot),
    quantity: purchase.quantity,
    amount_baht: Number(purchase.amountBaht),
    tickets_added: purchase.ticketQuotaAdded,
    events_added: purchase.eventQuotaAdded,
    target_event_id: purchase.targetEventId,
    status: purchase.status,
    created_at: purchase.createdAt,
    paid_at: purchase.paidAt,
  };
}

// GET /v1/vendors/me/quota
router.get('/quota', requireAuth, async (req, res) => {
  const vendorId = await ownedVendorId(req.userId);
  if (!vendorId) return res.status(404).json({ error: 'NO_VENDOR' });

  const quota = await getVendorQuota(vendorId);
  if (!quota) return res.status(404).json({ error: 'NO_QUOTA', message: 'ร้านยังไม่ได้รับอนุมัติ' });

  const pkg = quota.currentPackage;
  return res.json({
    ticket_balance: quota.ticketBalance,
    event_balance: quota.eventBalance,
    // The per-event ceiling is what stops a whole ticket pool going into one event,
    // so the app needs it up front to validate before the user fills in a form.
    ticket_per_event: pkg.ticketPerEvent,
    package: {
      code: pkg.code,
      name: pkg.name,
      tier: pkg.tier,
      topup_enabled: pkg.topupEnabled,
      event_topup_price: Number(pkg.eventTopupPrice),
      ticket_topup_price: Number(pkg.ticketTopupPrice),
      ticket_topup_bundle_size: pkg.ticketPerEvent,
    },
  });
});

// GET /v1/vendors/me/purchases
router.get('/purchases', requireAuth, async (req, res) => {
  const vendorId = await ownedVendorId(req.userId);
  if (!vendorId) return res.status(404).json({ error: 'NO_VENDOR' });

  const purchases = await prisma.purchase.findMany({
    where: { vendorId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return res.json(purchases.map(purchaseView));
});

// POST /v1/vendors/me/purchases — { type, package_id?, quantity?, target_event_id? }
//
// Creates the order and a pending charge, and returns whatever the client needs to pay.
// It deliberately does NOT grant any quota: that happens only when the gateway confirms
// through the webhook below, so an abandoned checkout can never hand out tickets.
router.post('/purchases', requireAuth, async (req, res) => {
  const vendorId = await ownedVendorId(req.userId);
  if (!vendorId) return res.status(404).json({ error: 'NO_VENDOR' });

  // A suspended vendor cannot buy its way to more quota — checked directly on Vendor,
  // not via shopAuth, since a vendor can in principle be suspended before it ever
  // creates a shop.
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } });
  if (vendor && vendor.status !== 'active') {
    return res.status(403).json({ error: 'VENDOR_SUSPENDED' });
  }

  const { type, package_id: packageId, quantity: rawQuantity, target_event_id: targetEventId } = req.body || {};
  if (!PURCHASE_TYPES.has(type)) return res.status(400).json({ error: 'INVALID_TYPE' });

  const quantity = rawQuantity === undefined ? 1 : Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TOPUP_QUANTITY) {
    return res.status(400).json({ error: 'INVALID_QUANTITY', max: MAX_TOPUP_QUANTITY });
  }

  const quota = await getVendorQuota(vendorId);
  if (!quota) return res.status(404).json({ error: 'NO_QUOTA', message: 'ร้านยังไม่ได้รับอนุมัติ' });

  let pkg;
  if (type === 'package') {
    if (!packageId) return res.status(400).json({ error: 'PACKAGE_REQUIRED' });
    pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) return res.status(404).json({ error: 'PACKAGE_NOT_FOUND' });

    // Upgrade-only. Without this rule a Gold vendor could keep re-buying Copper — three
    // events plus thirty tickets for 59฿ — which undercuts their own top-up prices and
    // makes the whole tier ladder pointless.
    if (pkg.tier <= quota.currentPackage.tier) {
      return res.status(409).json({
        error: 'DOWNGRADE_NOT_ALLOWED',
        message: 'ซื้อได้เฉพาะแพ็กเกจที่สูงกว่าปัจจุบัน ถ้าต้องการเพิ่มโควตาให้ใช้การซื้อเพิ่ม (top-up)',
        current_tier: quota.currentPackage.tier,
      });
    }
  } else {
    // Top-ups are always priced by the tier the vendor is already on.
    pkg = quota.currentPackage;
    if (!pkg.topupEnabled) {
      return res.status(409).json({
        error: 'TOPUP_NOT_AVAILABLE',
        message: 'แพ็กเกจ Free ซื้อเพิ่มไม่ได้ กรุณาอัปเกรดแพ็กเกจก่อน',
      });
    }
  }

  if (type === 'ticket_topup' && targetEventId) {
    // Raising one event's ceiling only makes sense for an event this vendor owns.
    const event = await prisma.event.findUnique({
      where: { id: targetEventId },
      select: { id: true, status: true, shop: { select: { vendorId: true } } },
    });
    if (!event || event.shop.vendorId !== vendorId) return res.status(404).json({ error: 'EVENT_NOT_FOUND' });
    if (event.status !== 'active') return res.status(409).json({ error: 'EVENT_NOT_ACTIVE' });
  } else if (type !== 'ticket_topup' && targetEventId) {
    return res.status(400).json({ error: 'TARGET_EVENT_NOT_APPLICABLE' });
  }

  const grant = describePurchase(pkg, { type, quantity });
  const provider = getProvider();

  const purchase = await prisma.purchase.create({
    data: {
      vendorId,
      type,
      packageId: pkg.id,
      packageCodeSnapshot: pkg.code,
      unitPriceSnapshot: grant.unitPrice,
      quantity: grant.quantity,
      amountBaht: grant.amount,
      ticketQuotaAdded: grant.ticketQuotaAdded,
      eventQuotaAdded: grant.eventQuotaAdded,
      targetEventId: type === 'ticket_topup' ? targetEventId ?? null : null,
      status: 'pending',
    },
  });

  const charge = await provider.createCharge({
    purchaseId: purchase.id,
    amountBaht: grant.amount,
    metadata: { vendor_id: vendorId, type },
  });

  const payment = await prisma.payment.create({
    data: {
      purchaseId: purchase.id,
      provider: provider.name,
      amountBaht: grant.amount,
      status: 'pending',
      providerRef: charge.providerRef,
      payload: charge.payload ?? null,
      expiresAt: charge.expiresAt ?? null,
    },
  });

  return res.status(201).json({
    purchase: purchaseView(purchase),
    payment: {
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      provider_ref: payment.providerRef,
      amount_baht: Number(payment.amountBaht),
      payload: payment.payload,
      expires_at: payment.expiresAt,
    },
  });
});

// GET /v1/vendors/me/purchases/:id — used by the app to poll while the user pays
router.get('/purchases/:id', requireAuth, async (req, res) => {
  const vendorId = await ownedVendorId(req.userId);
  if (!vendorId) return res.status(404).json({ error: 'NO_VENDOR' });

  const purchase = await prisma.purchase.findUnique({
    where: { id: req.params.id },
    include: { payment: true },
  });
  if (!purchase || purchase.vendorId !== vendorId) return res.status(404).json({ error: 'NOT_FOUND' });

  return res.json({
    purchase: purchaseView(purchase),
    payment_status: purchase.payment ? purchase.payment.status : null,
  });
});

// --- Gateway callback, mounted at /v1/payments ---

// POST /v1/payments/webhook
//
// The ONLY place quota is granted. Real gateways retry callbacks, so this has to be
// safe to receive any number of times: the work is guarded by a conditional update on
// Payment.status plus the ledger's UNIQUE (reason, ref_id).
webhookRouter.post('/webhook', async (req, res) => {
  const provider = getProvider();

  const verified = await provider.verifyCallback(req);
  if (!verified) return res.status(400).json({ error: 'INVALID_CALLBACK' });

  const payment = await prisma.payment.findUnique({
    where: { providerRef: verified.providerRef },
    include: { purchase: true },
  });
  if (!payment) return res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });

  if (verified.status !== 'succeeded') {
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'failed' },
      }),
      prisma.purchase.updateMany({
        where: { id: payment.purchaseId, status: 'pending' },
        data: { status: 'failed' },
      }),
    ]);
    return res.json({ ok: true, status: 'failed' });
  }

  const alreadyApplied = await prisma.$transaction(async (tx) => {
    // Whoever flips this row from pending is the one who grants the quota. A retry
    // finds it already settled and does nothing.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'succeeded', paidAt: new Date() },
    });
    if (claimed.count === 0) return true;

    const purchase = await tx.purchase.update({
      where: { id: payment.purchaseId },
      data: { status: 'paid', paidAt: new Date() },
    });

    await creditQuota(tx, {
      vendorId: purchase.vendorId,
      ticketDelta: purchase.ticketQuotaAdded,
      eventDelta: purchase.eventQuotaAdded,
      reason: REASON.PURCHASE,
      refId: purchase.id,
    });

    if (purchase.type === 'package') {
      // Balances carry over rather than reset — the vendor paid for what they still
      // hold — and the new tier's ceiling applies to events created from now on.
      await tx.vendorQuota.update({
        where: { vendorId: purchase.vendorId },
        data: { currentPackageId: purchase.packageId },
      });
    }

    if (purchase.type === 'ticket_topup' && purchase.targetEventId) {
      // Mints real Ticket rows into the event's batch and spends the credit above back
      // out of the pool. Raising Event.ticketCap alone (what this used to do) moved a
      // ceiling nothing could fill, so the event stayed sold out after payment.
      await applyTicketTopupToEvent(tx, {
        vendorId: purchase.vendorId,
        eventId: purchase.targetEventId,
        purchaseId: purchase.id,
        ticketQty: purchase.ticketQuotaAdded,
      });
    }

    return false;
  });

  return res.json({ ok: true, status: 'succeeded', already_applied: alreadyApplied });
});

module.exports = router;
module.exports.webhookRouter = webhookRouter;
