import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@bca.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { emailVerifiedAt: new Date() },
    create: { name: 'Admin', email: adminEmail, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() }
  });

  console.log('Seed complete. Admin:', admin.email);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });


