// Dev-only helper: adds a handful of approved vendors/shops/events with real
// AVAILABLE tickets so the app has something to browse/register/scan during
// manual testing. Drives the real HTTP API (like test/helpers.js's
// createApprovedShopWithEvent) so ticket codes, quota consumption, and
// ticketCap enforcement all go through the same code the app itself uses —
// nothing here re-implements that logic. Bypasses only the OTP login step and
// the admin-approval step, both via direct Prisma writes, same as the test
// helper does.
//
// Safe to re-run: skips a shop that already has events instead of duplicating.
require('dotenv').config();
const prisma = require('../src/services/prismaClient');
const { signToken } = require('../src/services/jwt');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const DEMO_SHOPS = [
  {
    ownerPhone: '0899000001',
    ownerName: 'เจ้าของร้านกาแฟดี',
    vendorName: 'ร้านกาแฟดี',
    shopName: 'กาแฟดี สาขาสยาม',
    shopAddress: '123 ถ.พระราม 1 กรุงเทพฯ',
    events: [
      { title: 'ลด 20% เครื่องดื่มทุกแก้ว', qty: 20, discount: 20, category: 'food_drink' },
      { title: 'ซื้อ 1 แถม 1 เค้กช็อกโกแลต', qty: 10, discount: 89, category: 'food_drink' },
    ],
  },
  {
    ownerPhone: '0899000002',
    ownerName: 'เจ้าของร้านข้าวมันไก่ป้าแดง',
    vendorName: 'ข้าวมันไก่ป้าแดง',
    shopName: 'ข้าวมันไก่ป้าแดง หน้ามอ',
    shopAddress: '45 ถ.พหลโยธิน กรุงเทพฯ',
    events: [{ title: 'ลดราคาข้าวมันไก่ 15 บาท', qty: 30, discount: 15, category: 'food_drink' }],
  },
  {
    ownerPhone: '0899000003',
    ownerName: 'เจ้าของร้านชานมไข่มุก',
    vendorName: 'ชานมไข่มุกหวานเจี๊ยบ',
    shopName: 'หวานเจี๊ยบ สาขาลาดพร้าว',
    shopAddress: '99 ถ.ลาดพร้าว กรุงเทพฯ',
    events: [{ title: 'อัปไซส์ฟรี ทุกแก้ว', qty: 15, discount: 15, category: 'food_drink' }],
  },
];

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`), { status: res.status, data });
  }
  return data;
}

async function ensureUser(phone, name) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) user = await prisma.user.create({ data: { phone, name } });
  return user;
}

async function grantGoldQuota(vendorId) {
  const pkg = await prisma.package.findUnique({ where: { code: 'gold' } });
  await prisma.vendorQuota.upsert({
    where: { vendorId },
    update: {
      currentPackageId: pkg.id,
      ticketBalance: pkg.eventQuota * pkg.ticketPerEvent,
      eventBalance: pkg.eventQuota,
    },
    create: {
      vendorId,
      currentPackageId: pkg.id,
      ticketBalance: pkg.eventQuota * pkg.ticketPerEvent,
      eventBalance: pkg.eventQuota,
    },
  });
}

async function seedShop(def) {
  const owner = await ensureUser(def.ownerPhone, def.ownerName);
  const token = signToken(owner.id);

  let ownership = await prisma.vendorOwnership.findFirst({
    where: { userId: owner.id },
    include: { vendor: { include: { shop: true } } },
  });

  let vendorId;
  let shopId;

  if (ownership) {
    vendorId = ownership.vendorId;
    shopId = ownership.vendor.shop?.id;
  } else {
    const vendor = await api('/v1/vendors', { method: 'POST', token, body: { name: def.vendorName } });
    vendorId = vendor.id;
    // Bypass the admin approval queue directly, same as test/helpers.js — approving
    // through the real admin endpoint would need a separate admin session for a
    // dev-only convenience script.
    await prisma.vendorVerification.update({ where: { vendorId }, data: { status: 'approved' } });
    await prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: 'approved' } });
    console.log(`สร้าง vendor: ${def.vendorName}`);
  }

  // Always ensure Gold (not just on first creation) — a prior interrupted run can
  // leave a vendor already-approved but backfilled onto Free by prisma/seed.js,
  // which would then reject the ticket quantities below as over-quota.
  await grantGoldQuota(vendorId);

  if (!shopId) {
    const shop = await api('/v1/shops', { method: 'POST', token, body: { name: def.shopName, address: def.shopAddress } });
    shopId = shop.id;
    console.log(`สร้างร้าน: ${def.shopName}`);
  }

  const existingEvents = await prisma.event.count({ where: { shopId } });
  if (existingEvents > 0) {
    console.log(`ข้าม event ของ "${def.shopName}" (มีอยู่แล้ว ${existingEvents} รายการ)`);
    return;
  }

  const startTime = new Date(Date.now() - 60_000);
  const endTime = new Date(Date.now() + 30 * 24 * 3600_000); // เปิดใช้ได้ 30 วันจากนี้

  for (const ev of def.events) {
    await api(`/v1/shops/${shopId}/events`, {
      method: 'POST',
      token,
      body: {
        title: ev.title,
        category: ev.category,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        total_qty: ev.qty,
        discount_value_baht: ev.discount,
      },
    });
    console.log(`  + event: "${ev.title}" (${ev.qty} ใบ)`);
  }
}

async function main() {
  try {
    await fetch(`${BASE_URL}/v1/health`);
  } catch {
    console.error(`ต่อ backend ที่ ${BASE_URL} ไม่ได้ — รัน "npm run dev" ก่อนแล้วค่อยรันสคริปต์นี้`);
    process.exit(1);
  }

  for (const def of DEMO_SHOPS) {
    await seedShop(def);
  }

  console.log('\nเสร็จแล้ว — เปิดแอปมือถือแล้วดูรายการ event ในหน้า Home ได้เลย (ใช้เบอร์ทดสอบเดิม login เข้าไปดูในฐานะลูกค้าได้ทันที)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
