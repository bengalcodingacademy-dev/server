import express from 'express';
import { z } from 'zod';

const purchaseSchema = z.object({
  courseId: z.string().uuid(),
  upiMobile: z.string().min(8).max(20),
  upiTxnId: z.string().min(6).max(64),
  amountCents: z.number().int().positive(),
  isMonthlyPayment: z.boolean().optional(),
  monthNumber: z.number().int().positive().optional(),
  totalMonths: z.number().int().positive().optional()
});

export function purchasesRouter(prisma) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    try {
      const { courseId, upiMobile, upiTxnId, amountCents, isMonthlyPayment, monthNumber, totalMonths } = purchaseSchema.parse(req.body);
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course || !course.isActive) return res.status(400).json({ error: 'Invalid course' });
      
      const purchase = await prisma.purchase.create({
        data: {
          userId: req.user.id,
          courseId,
          amountCents,
          status: 'PENDING',
          upiMobile,
          upiTxnId,
          isMonthlyPayment: isMonthlyPayment || false,
          monthNumber,
          totalMonths
        }
      });
      res.json(purchase);
    } catch (e) { next(e); }
  });

  router.get('/me', async (req, res, next) => {
    try {
      // Use the composite index for optimal performance
      const list = await prisma.purchase.findMany({
        where: { 
          userId: req.user.id 
        },
        include: { 
          course: {
            select: {
              id: true,
              title: true,
              slug: true,
              imageUrl: true,
              shortDesc: true,
              isMonthlyPayment: true,
              durationMonths: true,
              monthlyFeeCents: true,
              priceCents: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        // Add a reasonable limit to prevent large result sets
        take: 100
      });
      
      // Temporarily disable caching to debug the issue
      // res.set('Cache-Control', 'private, max-age=60'); // Cache for 1 minute
      res.json(list);
    } catch (e) { next(e); }
  });

  return router;
}


