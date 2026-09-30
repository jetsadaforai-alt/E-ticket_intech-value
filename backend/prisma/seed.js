// Bootstraps the first SuperAdmin account and the four quota packages.
//
// createdBy is nullable ONLY for the seeded admin row
// — every other AdminAccount must be created through POST /v1/superadmin/admins by an
// existing super_admin.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../src/services/prismaClient');
const { ensureVendorQuota } = require('../src/services/quota');
const { PACKAGES } = require('./packageCatalog');

async function seedSuperAdmin() {
  const username = process.env.SEED_SUPERADMIN_USERNAME || 'superadmin';
  const password = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!';
  const phone = process.env.SEED_SUPERADMIN_PHONE || '0800000000';

  const existing = await prisma.adminAccount.findUnique({ where: { username } });
  if (existing) {
    console.log(`SuperAdmin "${username}" already exists, skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminAccount.create({
    data: { username, passwordHash, phone, role: 'super_admin', createdBy: null },
  });
  console.log(`Seeded SuperAdmin "${username}" (phone ${phone}). Change the password before any real deployment.`);
}

async function seedPackages() {
  for (const pkg of PACKAGES) {
    // create-only on the pricing fields: SuperAdmin edits prices through the admin web,
    // and re-running the seed must not quietly undo their changes.
    await prisma.package.upsert({
      where: { code: pkg.code },
      update: { name: pkg.name, sortOrder: pkg.sortOrder },
      create: pkg,
    });
  }
  console.log(`Seeded ${PACKAGES.length} packages (existing prices left untouched).`);
}

async function backfillVendorQuotas() {
  // Vendors approved before the quota system existed have no wallet, which would make
  // every event they try to create fail with NO_QUOTA.
  const approved = await prisma.vendor.findMany({
    where: { verificationStatus: 'approved', quota: { is: null } },
    select: { id: true },
  });
  for (const vendor of approved) {
    await ensureVendorQuota(prisma, vendor.id);
  }
  if (approved.length > 0) console.log(`Backfilled Free quota for ${approved.length} approved vendor(s).`);
}

async function main() {
  await seedSuperAdmin();
  await seedPackages();
  await backfillVendorQuotas();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
