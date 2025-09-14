import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Note: Admin credentials should be manually added to the Admin table
  // Example SQL to add admin manually:
  

  const coursesData = [
    { title: 'Full-Stack Web Dev', slug: 'full-stack-web-dev', priceCents: 29900, shortDesc: 'Learn MERN stack', longDesc: 'Comprehensive MERN course', duration: '12 weeks', isActive: true },
    { title: 'Data Structures & Algorithms', slug: 'dsa-essentials', priceCents: 19900, shortDesc: 'Ace interviews', longDesc: 'In-depth DSA', duration: '10 weeks', isActive: true },
    { title: 'DevOps Foundations', slug: 'devops-foundations', priceCents: 24900, shortDesc: 'CI/CD & Cloud', longDesc: 'Practical DevOps', duration: '8 weeks', isActive: true }
  ];
  for (const c of coursesData) {
    await prisma.course.upsert({ where: { slug: c.slug }, update: {}, create: c });
  }

  const anns = [
    { title: 'Welcome to Bengal Coding Academy', body: 'Kickstart your journey with our curated paths.' },
    { title: 'Webinar Week', body: 'Join our free webinars this Friday!' }
  ];
  for (const a of anns) {
    await prisma.announcement.create({ data: a });
  }

  await prisma.webinar.create({ data: { title: 'Get Started with React', description: 'Basics to advanced overview', presenter: 'R. Sen', startTime: new Date(Date.now() + 3 * 24 * 3600 * 1000), joinLink: 'https://example.com/join/react' } });

  console.log('Seed complete. Admin credentials should be manually added to Admin table.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });


