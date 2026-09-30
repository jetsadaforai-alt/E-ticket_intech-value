const { asyncRouter } = require('../lib/asyncRouter');
const { DateTime } = require('luxon');
const prisma = require('../services/prismaClient');
const { requireAdminAuth, requireSuperAdmin } = require('../middleware/adminAuth');

const router = asyncRouter(); // mounted at /v1/superadmin/dashboard
router.use(requireAdminAuth, requireSuperAdmin);

const TREND_DAYS = 30;

// Turns a Prisma groupBy `[{ <field>: 'x', _count: n }, ...]` result into a plain
// `{ x: n }` map with every one of `statuses` present (defaulting to 0), so the
// frontend never has to guard against a status that simply has no rows yet.
function countsByStatus(groups, field, statuses) {
  const map = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const g of groups) map[g[field]] = g._count;
  return map;
}

// Prisma Decimal → number. Every money column here is Decimal(10,2), which arrives as a
// Decimal object (or null when there are no rows to sum).
const money = (d) => (d == null ? 0 : Number(d));

/**
 * Sums money only over purchases the gateway actually confirmed.
 *
 * A Purchase row is written with status 'pending' *before* any money moves (see
 * routes/purchases.js) and only becomes 'paid' in the webhook transaction. Summing
 * without this filter would report abandoned checkouts as revenue — and the pending
 * bucket is permanently polluted, because a vendor who closes the app mid-payment
 * leaves a pending row that nothing ever cleans up.
 */
const PAID = { status: 'paid' };

// GET /v1/superadmin/dashboard — platform-wide summary for the superadmin landing page
router.get('/', async (req, res) => {
  const now = DateTime.now().setZone('Asia/Bangkok');
  const startOfDay = now.startOf('day').toUTC().toJSDate();
  const endOfDay = now.endOf('day').toUTC().toJSDate();
  // Inclusive window: today plus the previous 29 days.
  const trendStart = now.startOf('day').minus({ days: TREND_DAYS - 1 }).toUTC().toJSDate();

  const [
    vendorGroups,
    vendorSuspensionGroups,
    shopCount,
    userGroups,
    eventGroups,
    ticketGroups,
    supportGroups,
    activeAdminCount,
    redemptionsTodayCount,
    // — money —
    revenueByType,
    revenueByTier,
    revenueTotal,
    // — quota —
    quotaOutstanding,
    ledgerByReason,
    // — value delivered —
    discountRedeemed,
    batchTotals,
    redemptionTotal,
    // — packages —
    vendorsPerPackage,
    packages,
    // — reviews —
    reviewAgg,
    reviewByRating,
    // — trends —
    revenueTrend,
    redemptionTrend,
  ] = await Promise.all([
    prisma.vendor.groupBy({ by: ['verificationStatus'], _count: true }),
    // Separate axis from verificationStatus (schema.prisma comment on Vendor.status) —
    // an approved vendor can independently be suspended, so this needs its own groupBy
    // rather than folding 'suspended' into the pending/approved/rejected breakdown above.
    prisma.vendor.groupBy({ by: ['status'], _count: true }),
    prisma.shop.count(),
    prisma.user.groupBy({ by: ['status'], _count: true }),
    prisma.event.groupBy({ by: ['status'], _count: true }),
    prisma.ticket.groupBy({ by: ['status'], _count: true }),
    prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
    prisma.adminAccount.count({ where: { status: 'active' } }),
    prisma.redemption.count({ where: { redeemedAt: { gte: startOfDay, lte: endOfDay } } }),

    prisma.purchase.groupBy({
      by: ['type'],
      where: PAID,
      _sum: { amountBaht: true },
      _count: { _all: true },
    }),
    // Grouped on the snapshot, never on a join to Package: SuperAdmin can edit prices,
    // and a past sale must keep the tier it was actually sold as.
    prisma.purchase.groupBy({
      by: ['packageCodeSnapshot'],
      where: PAID,
      _sum: { amountBaht: true },
      _count: { _all: true },
    }),
    prisma.purchase.aggregate({
      where: PAID,
      _sum: { amountBaht: true },
      _avg: { amountBaht: true },
      _count: { _all: true },
    }),

    // Unspent credit vendors already hold — the platform's outstanding obligation.
    // Unaffected by the pending-purchase bug, since paid quota is only ever granted
    // inside the webhook transaction.
    //
    // Deliberately NOT shipped here: a "balance vs ledger" integrity tile. It reads as an
    // obvious guarantee to display, but the invariant does not actually hold —
    // `ensureVendorQuota` grants the Free tier's opening balance without writing a ledger
    // row, so every vendor is off by exactly that grant and the tile would sit red
    // forever over healthy data. Fixing the source (ledger the opening grant + backfill)
    // is quota-accounting work, not dashboard work.
    prisma.vendorQuota.aggregate({ _sum: { ticketBalance: true, eventBalance: true } }),
    prisma.quotaLedger.groupBy({
      by: ['reason'],
      _sum: { ticketDelta: true, eventDelta: true },
      _count: { _all: true },
    }),

    // Value actually delivered to customers. Read off Redemption, NOT TicketBatch: the
    // batch's discount rate can be edited later, while a redemption keeps the amount that
    // was really honoured (same rule as routes/shops.js).
    prisma.redemption.aggregate({ _sum: { discountValueBaht: true } }),
    prisma.ticketBatch.aggregate({ _sum: { totalQty: true, remainingCount: true } }),
    prisma.redemption.count(),

    prisma.vendorQuota.groupBy({ by: ['currentPackageId'], _count: { _all: true } }),
    prisma.package.findMany({ select: { id: true, code: true, name: true, tier: true }, orderBy: { tier: 'asc' } }),

    prisma.eventReview.aggregate({ _avg: { rating: true }, _count: { _all: true } }),
    prisma.eventReview.groupBy({ by: ['rating'], _count: { _all: true } }),

    // Date bucketing can't be expressed through Prisma's groupBy, and firing 30 parallel
    // count() calls per series would be 60 round-trips. Two raw queries instead.
    //
    // `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'` — both halves are required.
    // Prisma maps DateTime to `timestamp WITHOUT time zone` holding a UTC instant, so a
    // bare `AT TIME ZONE 'Asia/Bangkok'` reads that value as if it were already Bangkok
    // wall-clock and shifts it 7 hours the wrong way. The first cast states what the
    // stored value actually is; only then does the second one convert it.
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS day,
             SUM(amount_baht)::float8 AS amount
      FROM purchases
      WHERE status = 'paid' AND paid_at >= ${trendStart}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', redeemed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM redemptions
      WHERE redeemed_at >= ${trendStart}
      GROUP BY 1 ORDER BY 1
    `,
  ]);

  const vendors = countsByStatus(vendorGroups, 'verificationStatus', ['pending', 'approved', 'rejected']);
  const vendorSuspension = countsByStatus(vendorSuspensionGroups, 'status', ['active', 'suspended']);
  const users = countsByStatus(userGroups, 'status', ['active', 'suspended']);
  const events = countsByStatus(eventGroups, 'status', ['active', 'expired', 'cancelled', 'banned']);
  // EXPIRED is deliberately absent: no code path ever writes it (event expiry returns
  // unclaimed tickets to AVAILABLE), so a bucket for it would be a permanent zero and
  // read as a broken metric. RESERVED is kept — it is an intentionally reserved value for
  // a Reserve→Confirm flow that mini skipped.
  const tickets = countsByStatus(ticketGroups, 'status', [
    'AVAILABLE', 'RESERVED', 'ISSUED', 'REDEEMED', 'CANCELLED',
  ]);
  const supportTickets = countsByStatus(supportGroups, 'status', [
    'open', 'investigating', 'resolved', 'closed',
  ]);

  const packageById = new Map(packages.map((p) => [p.id, p]));
  const issued = (batchTotals._sum.totalQty ?? 0) - (batchTotals._sum.remainingCount ?? 0);

  // Fill gaps so the chart shows a continuous 30-day axis rather than skipping quiet days.
  const series = (rows, key) => {
    const byDay = new Map(rows.map((r) => [r.day, Number(r[key])]));
    return Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = now.startOf('day').minus({ days: TREND_DAYS - 1 - i }).toFormat('yyyy-MM-dd');
      return { day, value: byDay.get(day) ?? 0 };
    });
  };

  return res.json({
    vendors: {
      ...vendors,
      total: vendors.pending + vendors.approved + vendors.rejected,
      suspended: vendorSuspension.suspended,
    },
    shops: { total: shopCount },
    users: {
      total: users.active + users.suspended,
      active: users.active,
      suspended: users.suspended,
    },
    events: { ...events, total: Object.values(events).reduce((sum, n) => sum + n, 0) },
    tickets: {
      ...tickets,
      total: Object.values(tickets).reduce((sum, n) => sum + n, 0),
    },
    supportTickets: {
      ...supportTickets,
      total: supportTickets.open + supportTickets.investigating + supportTickets.resolved + supportTickets.closed,
    },
    admins: { active: activeAdminCount },
    redemptionsToday: redemptionsTodayCount,

    revenue: {
      total: money(revenueTotal._sum.amountBaht),
      order_count: revenueTotal._count._all,
      average_order: money(revenueTotal._avg.amountBaht),
      by_type: revenueByType.map((r) => ({
        type: r.type,
        amount: money(r._sum.amountBaht),
        count: r._count._all,
      })),
      by_tier: revenueByTier.map((r) => ({
        package_code: r.packageCodeSnapshot,
        amount: money(r._sum.amountBaht),
        count: r._count._all,
      })),
    },

    quota: {
      outstanding_tickets: quotaOutstanding._sum.ticketBalance ?? 0,
      outstanding_events: quotaOutstanding._sum.eventBalance ?? 0,
      ledger: ledgerByReason.map((r) => ({
        reason: r.reason,
        ticket_delta: r._sum.ticketDelta ?? 0,
        event_delta: r._sum.eventDelta ?? 0,
        entries: r._count._all,
      })),
    },

    value: {
      discount_redeemed: money(discountRedeemed._sum.discountValueBaht),
      tickets_issued: issued,
      tickets_redeemed: redemptionTotal,
    },

    packages: packages.map((p) => ({
      code: p.code,
      name: p.name,
      tier: p.tier,
      vendor_count: vendorsPerPackage.find((v) => v.currentPackageId === p.id)?._count._all ?? 0,
    })),
    // Defensive: a VendorQuota pointing at a deleted Package would otherwise vanish
    // silently from the tier breakdown.
    unknown_package_vendors: vendorsPerPackage
      .filter((v) => !packageById.has(v.currentPackageId))
      .reduce((sum, v) => sum + v._count._all, 0),

    reviews: {
      average: reviewAgg._count._all === 0 ? null : Math.round(reviewAgg._avg.rating * 10) / 10,
      count: reviewAgg._count._all,
      distribution: [1, 2, 3, 4, 5].reduce((acc, n) => {
        acc[n] = reviewByRating.find((r) => r.rating === n)?._count._all ?? 0;
        return acc;
      }, {}),
    },

    trends: {
      days: TREND_DAYS,
      revenue: series(revenueTrend, 'amount'),
      redemptions: series(redemptionTrend, 'count'),
    },
  });
});

module.exports = router;
