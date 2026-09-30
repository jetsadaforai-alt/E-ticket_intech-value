const prisma = require('./prismaClient');

// Loads once per check — a shop row plus its vendor's suspension status. Every function
// below treats a suspended vendor as a fail-closed "no": staff scanning, chat, event
// editing, product management, and everything else scoped to a shop stops working the
// moment its vendor is suspended, without each of the 15+ call sites needing its own
// check.
async function loadShopWithVendorStatus(shopId) {
  return prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, vendorId: true, vendor: { select: { status: true } } },
  });
}

// True if userId is the vendor owner of shopId OR an active manager assigned to it.
async function isShopManagerOrOwner(userId, shopId) {
  const shop = await loadShopWithVendorStatus(shopId);
  if (!shop || shop.vendor.status !== 'active') return false;

  const isOwner = await prisma.vendorOwnership.findUnique({
    where: { userId_vendorId: { userId, vendorId: shop.vendorId } },
  });
  if (isOwner) return true;

  const isManager = await prisma.shopStaffAssignment.findFirst({
    where: { userId, shopId, role: 'manager', status: 'active' },
  });
  return Boolean(isManager);
}

// True if userId is allowed to scan/redeem at shopId — owner, active manager, or
// active staff.
async function isActiveShopMember(userId, shopId) {
  const shop = await loadShopWithVendorStatus(shopId);
  if (!shop || shop.vendor.status !== 'active') return false;

  const isOwner = await prisma.vendorOwnership.findUnique({
    where: { userId_vendorId: { userId, vendorId: shop.vendorId } },
  });
  if (isOwner) return true;

  const isMember = await prisma.shopStaffAssignment.findFirst({
    where: { userId, shopId, role: { in: ['manager', 'staff'] }, status: 'active' },
  });
  return Boolean(isMember);
}

// Resolves whether a shop's vendor is currently suspended — for the handful of
// user-facing endpoints that want to answer a specific VENDOR_SUSPENDED/SHOP_SUSPENDED
// instead of the generic FORBIDDEN that isShopManagerOrOwner/isActiveShopMember collapse
// down to: shops.js (view shop, create event), purchases.js, staffScan.js.
async function isVendorSuspendedForShop(shopId) {
  const shop = await loadShopWithVendorStatus(shopId);
  return shop ? shop.vendor.status !== 'active' : false;
}

module.exports = { isShopManagerOrOwner, isActiveShopMember, isVendorSuspendedForShop };
