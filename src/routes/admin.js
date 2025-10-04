import express from 'express';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

const upsertCourseSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2),
  imageUrl: z.string().url().nullable().optional(),
  priceRupees: z.number().nonnegative(),
  shortDesc: z.string().min(2),
  longDesc: z.string().min(2),
  duration: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  syllabusJson: z.any().optional(),
  // New enhanced fields
  numberOfModules: z.number().int().nonnegative().optional(),
  modulesJson: z.any().optional(),
  numberOfLectures: z.number().int().nonnegative().optional(),
  language: z.enum(['english', 'hindi', 'bengali']).default('bengali'),
  starRating: z.number().min(0).max(5).optional(),
  numberOfStudents: z.number().int().nonnegative().optional(),
  aboutCourse: z.string().optional(),
  courseIncludes: z.any().optional(),
  // Monthly payment fields
  durationMonths: z.number().int().min(0).optional(),
  monthlyFeeRupees: z.number().nonnegative().optional(),
  isMonthlyPayment: z.boolean().optional(),
  // Additional course details
  programmingLanguage: z.string().optional(),
  classSchedule: z.string().optional(),
  classTimings: z.string().optional(),
  isActive: z.boolean().optional()
});

const webinarSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  presenter: z.string().optional(),
  startTime: z.string().optional(),
  joinLink: z.string().optional(),
  imageUrl: z.string().url().optional()
});

const announcementSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(2),
  courseId: z.string().optional()
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
  router.get('/courses', async (req, res, next) => {
    try {
      const courses = await prisma.course.findMany({
        where: { isActive: true },
        include: {
          coupons: true,
          testimonials: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100 // Limit results
      });
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=60'); // Cache for 1 minute
      res.json(courses);
    } catch (e) { next(e); }
  });

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

  router.get('/courses/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const course = await prisma.course.findUnique({ 
        where: { id },
        include: { 
          testimonials: true,
          coupons: true
        }
      });
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }
      res.json(course);
    } catch (e) { next(e); }
  });

  router.delete('/courses/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      console.log(`Attempting to delete course with ID: ${id}`);
      
      // Check if course exists
      const course = await prisma.course.findUnique({ where: { id } });
      if (!course) {
        console.log(`Course not found with ID: ${id}`);
        return res.status(404).json({ error: 'Course not found' });
      }
      
      console.log(`Found course: ${course.title}, proceeding with deletion...`);
      
      // Delete related data first (without transaction to avoid timeout)
      try {
        // Delete all course content for this course
        const courseContentDeleted = await prisma.courseContent.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${courseContentDeleted.count} course content records`);
        
        // Delete all purchases for this course
        const purchasesDeleted = await prisma.purchase.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${purchasesDeleted.count} purchase records`);
        
        // Delete all monthly purchases for this course
        const monthlyPurchasesDeleted = await prisma.monthlyPurchase.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${monthlyPurchasesDeleted.count} monthly purchase records`);
        
        // Delete all testimonials for this course
        const testimonialsDeleted = await prisma.testimonial.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${testimonialsDeleted.count} testimonial records`);
        
        // Delete all coupons for this course
        const couponsDeleted = await prisma.coupon.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${couponsDeleted.count} coupon records`);
        
        // Delete all announcements for this course
        const announcementsDeleted = await prisma.announcement.deleteMany({ 
          where: { courseId: id } 
        });
        console.log(`Deleted ${announcementsDeleted.count} announcement records`);
        
        // Finally delete the course itself
        await prisma.course.delete({ where: { id } });
        console.log(`Successfully deleted course: ${course.title}`);
        
      } catch (deleteError) {
        console.error('Error during deletion:', deleteError);
        // Check if course still exists
        const courseStillExists = await prisma.course.findUnique({ where: { id } });
        if (courseStillExists) {
          throw deleteError; // Re-throw if course still exists
        }
        // If course is already deleted, consider it successful
        console.log('Course was already deleted, considering operation successful');
      }
      
      res.json({ ok: true, message: 'Course and all associated data deleted successfully' });
    } catch (e) { 
      console.error('Error deleting course:', e);
      next(e); 
    }
  });

  // Purchases table
  router.get('/purchases', async (req, res, next) => {
    try {
      const list = await prisma.purchase.findMany({ 
        include: { 
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }, 
          course: {
            select: {
              id: true,
              title: true,
              isMonthlyPayment: true,
              durationMonths: true
            }
          }
        }, 
        orderBy: { createdAt: 'desc' },
        take: 100 // Limit results
      });
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=30'); // Cache for 30 seconds
      res.json(list);
    } catch (e) { next(e); }
  });


  // Webinars
  router.post('/webinars', async (req, res, next) => {
    try {
      const data = webinarSchema.parse(req.body);
      const createData = { ...data };
      if (data.startTime) {
        createData.startTime = new Date(data.startTime);
      }
      const item = await prisma.webinar.create({ data: createData });
      res.json(item);
    } catch (e) { 
      if (e.name === 'ZodError') {
        return res.status(400).json({
          issues: e.issues,
          message: 'Validation failed'
        });
      }
      next(e); 
    }
  });
  router.put('/webinars/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = webinarSchema.parse(req.body);
      const updateData = { ...data };
      if (data.startTime) {
        updateData.startTime = new Date(data.startTime);
      }
      const item = await prisma.webinar.update({ where: { id }, data: updateData });
      res.json(item);
    } catch (e) { 
      if (e.name === 'ZodError') {
        return res.status(400).json({
          issues: e.issues,
          message: 'Validation failed'
        });
      }
      next(e); 
    }
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
      
      // Create notification receipts for users
      if (data.courseId) {
        // Course-specific announcement: create receipts for users who purchased that course
        const coursePurchases = await prisma.purchase.findMany({
          where: { courseId: data.courseId, status: 'PAID' },
          select: { userId: true }
        });
        
        const receipts = coursePurchases.map(purchase => ({
          userId: purchase.userId,
          announcementId: ann.id,
          isRead: false
        }));
        
        if (receipts.length > 0) {
          await prisma.notificationReceipt.createMany({ data: receipts });
        }
      } else {
        // Global announcement: create receipts for all users
        const allUsers = await prisma.user.findMany({
          select: { id: true }
        });
        
        const receipts = allUsers.map(user => ({
          userId: user.id,
          announcementId: ann.id,
          isRead: false
        }));
        
        if (receipts.length > 0) {
          await prisma.notificationReceipt.createMany({ data: receipts });
        }
      }
      
      res.json(ann);
    } catch (e) { next(e); }
  });

  // Delete announcement
  router.delete('/announcements/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      
      // First delete all notification receipts for this announcement
      await prisma.notificationReceipt.deleteMany({
        where: { announcementId: id }
      });
      
      // Then delete the announcement itself
      await prisma.announcement.delete({ where: { id } });
      
      res.json({ success: true, message: 'Announcement deleted successfully' });
    } catch (e) { 
      console.error('Error deleting announcement:', e);
      next(e); 
    }
  });

  // Analytics
  router.get('/stats/monthly-sales', async (req, res, next) => {
    try {
      const year = parseInt(req.query.year, 10);
      if (!year || Number.isNaN(year)) return res.status(400).json({ error: 'Invalid year' });
      const start = new Date(`${year}-01-01T00:00:00.000Z`);
      const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
      const rows = await prisma.$queryRawUnsafe(`
        SELECT EXTRACT(MONTH FROM "createdAt") AS month, SUM("amountRupees") AS revenue, COUNT(*) AS orders
        FROM "Purchase"
        WHERE "createdAt" >= $1 AND "createdAt" < $2 AND status = 'PAID'
        GROUP BY month ORDER BY month;
      `, start, end);
      const result = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const row = Array.isArray(rows) ? rows.find(r => Number(r.month) === m) : null;
        return { 
          month: m, 
          totalAmount: row ? Number(row.revenue) / 100 : 0, // Convert to rupees
          orderCount: row ? Number(row.orders) : 0 
        };
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  router.get('/stats/daily-sales', async (req, res, next) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);
      if (!year || !month || Number.isNaN(year) || Number.isNaN(month)) {
        return res.status(400).json({ error: 'Invalid year or month' });
      }
      
      const start = new Date(`${year}-${month.toString().padStart(2, '0')}-01T00:00:00.000Z`);
      const end = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month
      
      const rows = await prisma.$queryRawUnsafe(`
        SELECT EXTRACT(DAY FROM "createdAt") AS day, SUM("amountRupees") AS revenue, COUNT(*) AS orders
        FROM "Purchase"
        WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND status = 'PAID'
        GROUP BY day ORDER BY day;
      `, start, end);
      
      const daysInMonth = new Date(year, month, 0).getDate();
      const result = Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const row = Array.isArray(rows) ? rows.find(r => Number(r.day) === day) : null;
        return { 
          day: day, 
          totalAmount: row ? Number(row.revenue) / 100 : 0, // Convert to rupees
          orderCount: row ? Number(row.orders) : 0 
        };
      });
      res.json(result);
    } catch (e) { next(e); }
  });

  router.get('/stats/yearly-sales', async (req, res, next) => {
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT EXTRACT(YEAR FROM "createdAt") AS year, SUM("amountRupees") AS revenue, COUNT(*) AS orders
        FROM "Purchase"
        WHERE status = 'PAID'
        GROUP BY year ORDER BY year;
      `);
      
      const result = Array.isArray(rows) ? rows.map(row => ({
        year: Number(row.year),
        totalAmount: Number(row.revenue), // Already in rupees
        orderCount: Number(row.orders)
      })) : [];
      
      res.json(result);
    } catch (e) { next(e); }
  });

  // Get detailed payments for specific date
  router.get('/stats/payments-by-date', async (req, res, next) => {
    try {
      const { year, month, day } = req.query;
      
      if (!year || Number.isNaN(parseInt(year))) {
        return res.status(400).json({ error: 'Invalid year' });
      }

      let startDate, endDate;
      
      if (day && month) {
        // Specific day
        const dayNum = parseInt(day);
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        
        if (Number.isNaN(dayNum) || Number.isNaN(monthNum)) {
          return res.status(400).json({ error: 'Invalid day or month' });
        }
        
        startDate = new Date(`${yearNum}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}T00:00:00.000Z`);
        endDate = new Date(`${yearNum}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}T23:59:59.999Z`);
      } else if (month) {
        // Specific month
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        
        if (Number.isNaN(monthNum)) {
          return res.status(400).json({ error: 'Invalid month' });
        }
        
        startDate = new Date(`${yearNum}-${monthNum.toString().padStart(2, '0')}-01T00:00:00.000Z`);
        endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999); // Last day of month
      } else {
        // Specific year
        const yearNum = parseInt(year);
        startDate = new Date(`${yearNum}-01-01T00:00:00.000Z`);
        endDate = new Date(`${yearNum + 1}-01-01T00:00:00.000Z`);
      }

      const payments = await prisma.purchase.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          },
          status: 'PAID'
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          course: {
            select: {
              id: true,
              title: true,
              isMonthlyPayment: true,
              durationMonths: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const result = payments.map(payment => ({
        id: payment.id,
        amount: parseFloat(payment.amountRupees), // Already in rupees
        status: payment.status,
        isMonthlyPayment: payment.isMonthlyPayment,
        monthNumber: payment.monthNumber,
        totalMonths: payment.totalMonths,
        createdAt: payment.createdAt,
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: payment.razorpayPaymentId,
        user: {
          id: payment.user.id,
          name: payment.user.name,
          email: payment.user.email
        },
        course: {
          id: payment.course.id,
          title: payment.course.title,
          isMonthlyPayment: payment.course.isMonthlyPayment,
          durationMonths: payment.course.durationMonths
        }
      }));

      res.json(result);
    } catch (e) { 
      console.error('Error fetching payments by date:', e);
      next(e); 
    }
  });

  // Users list (read-only)
  router.get('/users', async (req, res, next) => {
    try {
      const users = await prisma.user.findMany({ 
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          age: true,
          dateOfBirth: true,
          createdAt: true,
          purchases: {
            select: {
              status: true,
              amountRupees: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 100 // Limit results
      });
      
      const mapped = users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        age: u.age,
        dateOfBirth: u.dateOfBirth,
        createdAt: u.createdAt,
        purchasesCount: u.purchases.filter(p=>p.status==='PAID').length,
        totalPaidRupees: u.purchases.filter(p=>p.status==='PAID').reduce((a,b)=>a+parseFloat(b.amountRupees),0)
      }));
      
      // Set cache headers
      res.set('Cache-Control', 'private, max-age=60'); // Cache for 1 minute
      res.json(mapped);
    } catch (e) { next(e); }
  });

// Presigned upload URL for S3 (course posters or user avatars)
router.post('/uploads/presign', async (req, res, next) => {
  try {
    console.log('=== ADMIN S3 PRESIGN DEBUG ===');
    
    // Validate the incoming request body with zod
    const body = z.object({ 
      key: z.string(),           // File key to upload to S3
      contentType: z.string().optional()  // Optional content type (image/jpeg, etc.)
    }).parse(req.body);

    console.log('Admin presign request body:', body);

    // Fetch the S3 bucket name from environment variables
    const bucket = process.env.S3_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'S3 bucket not configured' });

    console.log('S3 bucket:', bucket);
    console.log('S3 region:', process.env.S3_REGION);

    // S3 upload without ACL (bucket has ACLs disabled)
    const post = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: body.key,
      Conditions: [
        ['starts-with', '$Content-Type', '']
      ],
      Fields: { 'Content-Type': body.contentType || 'application/octet-stream' },
      Expires: 60
    });

    const publicUrl = `https://${bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${body.key}`;
    
    console.log('Generated presigned POST:', post);
    console.log('Public URL:', publicUrl);
    console.log('=== END ADMIN S3 PRESIGN DEBUG ===');
    
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
        studentAbout: z.string().optional(),
        comment: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        courseId: z.string().optional()
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
        studentAbout: z.string().optional(),
        comment: z.string().min(1),
        rating: z.number().int().min(1).max(5),
        courseId: z.string().optional()
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

  // YouTube Videos CRUD
  router.get('/youtube-videos', async (req, res, next) => {
    try {
      const videos = await prisma.youTubeVideo.findMany({ 
        orderBy: { createdAt: 'desc' } 
      });
      res.json(videos);
    } catch (e) { next(e); }
  });

  router.post('/youtube-videos', async (req, res, next) => {
    try {
      const data = z.object({
        title: z.string().min(1),
        videoUrl: z.string().url(),
        thumbnailUrl: z.string().url().optional(),
        isActive: z.boolean().optional()
      }).parse(req.body);
      
      const video = await prisma.youTubeVideo.create({ data });
      res.json(video);
    } catch (e) { next(e); }
  });

  router.put('/youtube-videos/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = z.object({
        title: z.string().min(1).optional(),
        videoUrl: z.string().url().optional(),
        thumbnailUrl: z.string().url().optional(),
        isActive: z.boolean().optional()
      }).parse(req.body);
      const video = await prisma.youTubeVideo.update({ where: { id }, data });
      res.json(video);
    } catch (e) { next(e); }
  });

  router.delete('/youtube-videos/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.youTubeVideo.delete({ where: { id } });
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

  // Cleanup failed purchases endpoint
  router.post('/cleanup-failed-purchases', async (req, res, next) => {
    try {
      // Delete PENDING purchases older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const deletedCount = await prisma.purchase.deleteMany({
        where: {
          status: 'PENDING',
          createdAt: {
            lt: oneHourAgo
          }
        }
      });

      res.json({ 
        message: `Cleaned up ${deletedCount.count} failed purchase records`,
        deletedCount: deletedCount.count
      });
    } catch (e) { 
      next(e); 
    }
  });

  return router;
}


