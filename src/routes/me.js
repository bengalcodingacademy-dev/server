import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';

export function meRouter(prisma) {
  const router = express.Router();

  // Simple auth middleware for protected routes
  const requireAuth = (req, res, next) => {
    try {
      let token = req.cookies?.accessToken;
      if (!token) {
        const authHeader = req.headers.authorization || '';
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      }
      
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: payload.sub, role: payload.role };
      next();
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };

  // Public endpoint to check auth status without requiring authentication
  router.get('/', async (req, res, next) => {
    try {
      // Try to get token from cookie first, then from Authorization header
      let token = req.cookies?.accessToken;
      if (!token) {
        const authHeader = req.headers.authorization || '';
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      }
      
      if (!token) {
        return res.json({ user: null, authenticated: false });
      }
      
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get basic user info
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          photoUrl: true
        }
      });
      
      if (!user) {
        return res.json({ user: null, authenticated: false });
      }
      
      res.json({ user, authenticated: true });
    } catch (e) {
      // Token invalid or expired
      res.json({ user: null, authenticated: false });
    }
  });

  router.get('/summary', requireAuth, async (req, res, next) => {
    try {
      // Get user data
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          age: true,
          photoUrl: true
        }
      });

      // Get regular purchases
      const purchases = await prisma.purchase.findMany({
        where: { userId: req.user.id },
        select: {
          status: true,
          amountRupees: true,
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true,
              shortDesc: true,
              isMonthlyPayment: true,
              durationMonths: true
            }
          }
        }
      });

      // Get monthly purchases
      const monthlyPurchases = await prisma.monthlyPurchase.findMany({
        where: { userId: req.user.id },
        select: {
          status: true,
          amountRupees: true,
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true,
              shortDesc: true,
              isMonthlyPayment: true,
              durationMonths: true
            }
          }
        }
      });

      // Combine all purchases
      const allPurchases = [...purchases, ...monthlyPurchases];
      
      const totalPaid = allPurchases.filter(p=>p.status==='PAID').reduce((a,b)=>a + parseFloat(b.amountRupees), 0);
      
      // Group purchases by course to avoid duplicate course entries
      const courseMap = new Map();
      allPurchases.filter(p=>p.status==='PAID').forEach(purchase => {
        const courseId = purchase.course.id;
        if (!courseMap.has(courseId)) {
          courseMap.set(courseId, {
            id: purchase.course.id, 
            title: purchase.course.title,
            slug: purchase.course.slug,
            imageUrl: purchase.course.imageUrl,
            shortDesc: purchase.course.shortDesc,
            isMonthlyPayment: purchase.course.isMonthlyPayment,
            durationMonths: purchase.course.durationMonths
          });
        }
      });
      
      const courses = Array.from(courseMap.values());
      const status = allPurchases.length === 0 ? 'NEW' : (courses.length > 0 ? 'ENROLLED' : 'PENDING');
      
      // Temporarily disable caching to debug the issue
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        age: user.age,
        photoUrl: user.photoUrl 
          ? user.photoUrl.replace(
              'https://sauvikbcabucket.s3.ap-south-1.amazonaws.com',
              'https://d270a3f3iqnh9i.cloudfront.net'
            )
          : user.photoUrl,
        status,
        totalPaidRupees: totalPaid,
        courses
      });
    } catch (e) { next(e); }
  });

  router.post('/photo', requireAuth, async (req, res, next) => {
    try {
      const body = { photoUrl: req.body.photoUrl };
      if (!body.photoUrl) return res.status(400).json({ error: 'photoUrl required' });
      const u = await prisma.user.update({ where: { id: req.user.id }, data: { photoUrl: body.photoUrl } });
      res.json({ ok: true, photoUrl: u.photoUrl });
    } catch (e) { next(e); }
  });

  // Meeting Requests
  router.get('/meeting-requests', requireAuth, async (req, res, next) => {
    try {
      const requests = await prisma.meetingRequest.findMany({ 
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' }
      });
      res.json(requests);
    } catch (e) { next(e); }
  });

  router.post('/meeting-requests', requireAuth, async (req, res, next) => {
    try {
      const { preferredDate, preferredTime, message } = req.body;
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      
      const request = await prisma.meetingRequest.create({
        data: {
          userId: req.user.id,
          studentName: user.name,
          studentEmail: user.email,
          preferredDate: new Date(preferredDate),
          preferredTime,
          message
        }
      });
      res.json(request);
    } catch (e) { next(e); }
  });

  // User-specific S3 presign for profile photo upload
  router.post('/uploads/presign', requireAuth, async (req, res, next) => {
    try {
      const { fileName, fileType } = req.body;
      
      console.log('=== S3 PRESIGN DEBUG ===');
      console.log('Request body:', { fileName, fileType });
      console.log('User ID:', req.user.id);
      
      if (!fileName || !fileType) {
        return res.status(400).json({ error: 'fileName and fileType are required' });
      }

      // Debug environment variables
      console.log('S3_REGION:', process.env.S3_REGION);
      console.log('S3_BUCKET:', process.env.S3_BUCKET);
      console.log('S3_ACCESS_KEY_ID:', process.env.S3_ACCESS_KEY_ID ? `${process.env.S3_ACCESS_KEY_ID.substring(0, 8)}...` : 'NOT SET');
      console.log('S3_SECRET_ACCESS_KEY:', process.env.S3_SECRET_ACCESS_KEY ? `${process.env.S3_SECRET_ACCESS_KEY.substring(0, 8)}...` : 'NOT SET');
      console.log('S3_PUBLIC_BASE:', process.env.S3_PUBLIC_BASE);

      // Initialize S3 client
      const s3Client = new S3Client({
        region: process.env.S3_REGION,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      });

      // Generate unique key for user's profile photo
      const key = `users/${req.user.id}/${fileName}`;
      console.log('Generated S3 key:', key);
      
      const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ContentType: fileType
      });

      console.log('PutObjectCommand created:', {
        Bucket: command.input.Bucket,
        Key: command.input.Key,
        ContentType: command.input.ContentType
      });

      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes
      const publicUrl = `${process.env.S3_PUBLIC_BASE}${key}`;

      console.log('Generated presigned URL:', presignedUrl);
      console.log('Generated public URL:', publicUrl);
      console.log('=== END S3 PRESIGN DEBUG ===');

      res.json({
        presignedUrl,
        publicUrl,
        key
      });
    } catch (error) {
      console.error('=== S3 PRESIGN ERROR ===');
      console.error('Error generating presigned URL:', error);
      console.error('Error message:', error.message);
      console.error('Error code:', error.code);
      console.error('Error name:', error.name);
      console.error('=== END S3 PRESIGN ERROR ===');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  });

  return router;
}


