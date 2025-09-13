import express from 'express';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

const upsertCourseSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  imageUrl: z.string().url().nullable().optional(),
  priceCents: z.number().int().nonnegative(),
  shortDesc: z.string().min(2),
  longDesc: z.string().min(2),
  duration: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  roadmapJson: z.any().optional(),
  syllabusJson: z.any().optional(),
  isActive: z.boolean().optional()
});

const webinarSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  presenter: z.string().optional(),
  startTime: z.string().datetime(),
  joinLink: z.string().url().optional()
});

const announcementSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(2)
});

export function adminRouter(prisma) {
  const router = express.Router();
  const s3 = new S3Client({
    region: process.env.S3_REGION,
    credentials: process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  });

  // Courses
  router.post('/courses', async (req, res, next) => {
    try {
      const { coupons, ...courseData } = req.body;
      const data = upsertCourseSchema.parse(courseData);
      const course = await prisma.course.create({ data });
      
      // Create coupons if provided
      if (coupons && coupons.length > 0) {
        const couponData = coupons.map(coupon => ({
          code: coupon.code,
          discountPercent: coupon.discountPercent,
          courseId: course.id
        }));
        await prisma.coupon.createMany({ data: couponData });
      }
      
      res.json(course);
    } catch (e) { next(e); }
  });

  router.put('/courses/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = upsertCourseSchema.parse(req.body);
      const course = await prisma.course.update({ where: { id }, data });
      res.json(course);
    } catch (e) { next(e); }
  });

  router.delete('/courses/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.course.delete({ where: { id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Purchases table
  router.get('/purchases', async (req, res, next) => {
    try {
      const list = await prisma.purchase.findMany({ include: { user: true, course: true }, orderBy: { createdAt: 'desc' } });
      res.json(list);
    } catch (e) { next(e); }
  });

  router.post('/purchases/:id/approve', async (req, res, next) => {
    try {
      const id = req.params.id;
      const p = await prisma.purchase.update({ where: { id }, data: { status: 'PAID' } });
      res.json(p);
    } catch (e) { next(e); }
  });

  router.post('/purchases/:id/decline', async (req, res, next) => {
    try {
      const id = req.params.id;
      const p = await prisma.purchase.update({ where: { id }, data: { status: 'DECLINED' } });
      res.json(p);
    } catch (e) { next(e); }
  });

  // Webinars
  router.post('/webinars', async (req, res, next) => {
    try {
      const data = webinarSchema.parse(req.body);
      const item = await prisma.webinar.create({ data: { ...data, startTime: new Date(data.startTime) } });
      res.json(item);
    } catch (e) { next(e); }
  });
  router.put('/webinars/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = webinarSchema.parse(req.body);
      const item = await prisma.webinar.update({ where: { id }, data: { ...data, startTime: new Date(data.startTime) } });
      res.json(item);
    } catch (e) { next(e); }
  });
  router.delete('/webinars/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.webinar.delete({ where: { id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Announcements
  router.post('/announcements', async (req, res, next) => {
    try {
      const data = announcementSchema.parse(req.body);
      const ann = await prisma.announcement.create({ data });
      res.json(ann);
    } catch (e) { next(e); }
  });

  // Analytics
  router.get('/stats/monthly-sales', async (req, res, next) => {
    try {
      const year = parseInt(req.query.year, 10);
      if (!year || Number.isNaN(year)) return res.status(400).json({ error: 'Invalid year' });
      const start = new Date(`${year}-01-01T00:00:00.000Z`);
      const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
      const rows = await prisma.$queryRawUnsafe(`
        SELECT EXTRACT(MONTH FROM "createdAt") AS month, SUM("amountCents") AS revenue, COUNT(*) AS orders
        FROM "Purchase"
        WHERE "createdAt" >= $1 AND "createdAt" < $2 AND status = 'PAID'
        GROUP BY month ORDER BY month;
      `, start, end);
      const result = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const row = Array.isArray(rows) ? rows.find(r => Number(r.month) === m) : null;
        return { month: m, totalRevenueCents: row ? Number(row.revenue) : 0, totalOrders: row ? Number(row.orders) : 0 };
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  // Users list (read-only)
  router.get('/users', async (req, res, next) => {
    try {
      const users = await prisma.user.findMany({ include: { purchases: true }, orderBy: { createdAt: 'desc' } });
      const mapped = users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        age: u.age,
        dateOfBirth: u.dateOfBirth,
        createdAt: u.createdAt,
        purchasesCount: u.purchases.filter(p=>p.status==='PAID').length,
        totalPaidCents: u.purchases.filter(p=>p.status==='PAID').reduce((a,b)=>a+b.amountCents,0)
      }));
      res.json(mapped);
    } catch (e) { next(e); }
  });

// Presigned upload URL for S3 (course posters or user avatars)
router.post('/uploads/presign', async (req, res, next) => {
  try {
    // Validate the incoming request body with zod
    const body = z.object({ 
      key: z.string(),           // File key to upload to S3
      contentType: z.string().optional()  // Optional content type (image/jpeg, etc.)
    }).parse(req.body);

    // Fetch the S3 bucket name from environment variables
    const bucket = process.env.S3_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'S3 bucket not configured' });

    // S3 only (public objects): allow ACL public-read so files are web-accessible
    const post = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: body.key,
      Conditions: [
        ['starts-with', '$Content-Type', ''],
        { acl: 'public-read' }
      ],
      Fields: { acl: 'public-read', 'Content-Type': body.contentType || 'application/octet-stream' },
      Expires: 60
    });

    const publicUrl = `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${body.key}`;
    res.json({ mode: 'post', post, publicUrl });
  } catch (e) {
    next(e);  // Pass any errors to the next middleware (error handler)
  }
});

  // Update user (admin)
  router.put('/users/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = z.object({ name: z.string().min(1), email: z.string().email(), role: z.enum(['USER','ADMIN','INSTRUCTOR','STUDENT']), age: z.union([z.coerce.number().int().nonnegative(), z.string().length(0)]), dateOfBirth: z.string().optional() }).parse(req.body);
      const update = {
        name: data.name,
        email: data.email,
        role: data.role,
        age: data.age === '' ? null : Number(data.age),
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null
      };
      const user = await prisma.user.update({ where: { id }, data: update });
      res.json(user);
    } catch (e) { next(e); }
  });

  // Testimonials CRUD
  router.get('/testimonials', async (req, res, next) => {
    try {
      const testimonials = await prisma.testimonial.findMany({ orderBy: { createdAt: 'desc' } });
      res.json(testimonials);
    } catch (e) { next(e); }
  });

  router.post('/testimonials', async (req, res, next) => {
    try {
      const data = z.object({
        studentName: z.string().min(1),
        studentImage: z.string().optional(),
        comment: z.string().min(1),
        rating: z.number().int().min(1).max(5)
      }).parse(req.body);
      const testimonial = await prisma.testimonial.create({ data });
      res.json(testimonial);
    } catch (e) { next(e); }
  });

  router.put('/testimonials/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = z.object({
        studentName: z.string().min(1),
        studentImage: z.string().optional(),
        comment: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        isActive: z.boolean().optional()
      }).parse(req.body);
      const testimonial = await prisma.testimonial.update({ where: { id }, data });
      res.json(testimonial);
    } catch (e) { next(e); }
  });

  router.delete('/testimonials/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.testimonial.delete({ where: { id } });
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // Coupons CRUD
  router.get('/courses/:courseId/coupons', async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const coupons = await prisma.coupon.findMany({ 
        where: { courseId },
        orderBy: { createdAt: 'desc' }
      });
      res.json(coupons);
    } catch (e) { next(e); }
  });

  router.post('/courses/:courseId/coupons', async (req, res, next) => {
    try {
      const { courseId } = req.params;
      const data = z.object({
        code: z.string().min(1),
        discountPercent: z.number().int().min(1).max(100)
      }).parse(req.body);
      const coupon = await prisma.coupon.create({ 
        data: { ...data, courseId }
      });
      res.json(coupon);
    } catch (e) { next(e); }
  });

  router.put('/coupons/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = z.object({
        code: z.string().min(1),
        discountPercent: z.number().int().min(1).max(100),
        isActive: z.boolean().optional()
      }).parse(req.body);
      const coupon = await prisma.coupon.update({ where: { id }, data });
      res.json(coupon);
    } catch (e) { next(e); }
  });

  router.delete('/coupons/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.coupon.delete({ where: { id } });
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // Meeting Requests CRUD
  router.get('/meeting-requests', async (req, res, next) => {
    try {
      const requests = await prisma.meetingRequest.findMany({ 
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' }
      });
      res.json(requests);
    } catch (e) { next(e); }
  });

  router.put('/meeting-requests/:id/approve', async (req, res, next) => {
    try {
      const id = req.params.id;
      const { adminMessage } = req.body;
      const request = await prisma.meetingRequest.update({ 
        where: { id }, 
        data: { 
          status: 'APPROVED',
          adminMessage: adminMessage || 'Your meeting request has been approved! We will contact you soon to schedule the session.'
        }
      });
      res.json(request);
    } catch (e) { next(e); }
  });

  router.put('/meeting-requests/:id/decline', async (req, res, next) => {
    try {
      const id = req.params.id;
      const { adminMessage } = req.body;
      const request = await prisma.meetingRequest.update({ 
        where: { id }, 
        data: { 
          status: 'DECLINED',
          adminMessage: adminMessage || 'Unfortunately, we cannot accommodate your meeting request at this time. Please try again later.'
        }
      });
      res.json(request);
    } catch (e) { next(e); }
  });

  return router;
}


