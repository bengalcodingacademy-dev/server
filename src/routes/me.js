import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export function meRouter(prisma) {
  const router = express.Router();

  router.get('/summary', async (req, res, next) => {
    try {
      // Optimize by only selecting needed fields and using selective includes
      const user = await prisma.user.findUnique({ 
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          age: true,
          photoUrl: true,
          purchases: {
            select: {
              status: true,
              amountCents: true,
              course: {
                select: {
                  id: true,
                  title: true,
                  imageUrl: true,
                  shortDesc: true,
                  isMonthlyPayment: true,
                  durationMonths: true
                }
              }
            }
          }
        }
      });
      
      const totalPaid = user.purchases.filter(p=>p.status==='PAID').reduce((a,b)=>a + b.amountCents, 0);
      
      // Group purchases by course to avoid duplicate course entries
      const courseMap = new Map();
      user.purchases.filter(p=>p.status==='PAID').forEach(purchase => {
        const courseId = purchase.course.id;
        if (!courseMap.has(courseId)) {
          courseMap.set(courseId, {
            id: purchase.course.id, 
            title: purchase.course.title,
            imageUrl: purchase.course.imageUrl,
            shortDesc: purchase.course.shortDesc,
            isMonthlyPayment: purchase.course.isMonthlyPayment,
            durationMonths: purchase.course.durationMonths
          });
        }
      });
      
      const courses = Array.from(courseMap.values());
      const status = user.purchases.length === 0 ? 'NEW' : (courses.length > 0 ? 'ENROLLED' : 'PENDING');
      
      // Temporarily disable caching to debug the issue
      // res.set('Cache-Control', 'private, max-age=30'); // Cache for 30 seconds
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        age: user.age,
        photoUrl: user.photoUrl,
        status,
        totalPaidCents: totalPaid,
        courses
      });
    } catch (e) { next(e); }
  });

  router.post('/photo', async (req, res, next) => {
    try {
      const body = { photoUrl: req.body.photoUrl };
      if (!body.photoUrl) return res.status(400).json({ error: 'photoUrl required' });
      const u = await prisma.user.update({ where: { id: req.user.id }, data: { photoUrl: body.photoUrl } });
      res.json({ ok: true, photoUrl: u.photoUrl });
    } catch (e) { next(e); }
  });

  // Meeting Requests
  router.get('/meeting-requests', async (req, res, next) => {
    try {
      const requests = await prisma.meetingRequest.findMany({ 
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' }
      });
      res.json(requests);
    } catch (e) { next(e); }
  });

  router.post('/meeting-requests', async (req, res, next) => {
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
  router.post('/uploads/presign', async (req, res, next) => {
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


