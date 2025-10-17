import express from 'express';
import { z } from 'zod';

export function couponsRouter(prisma) {
  const router = express.Router();

  // List coupons
  router.get('/', async (req, res, next) => {
    try {
      const coupons = await prisma.coupon.findMany({
        include: {
          course: { select: { id: true, title: true, slug: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(coupons);
    } catch (e) { next(e); }
  });

  // Create coupon
  router.post('/', async (req, res, next) => {
    try {
      const schema = z.object({
        code: z.string().min(3),
        discountPercent: z.number().int().min(1).max(100),
        courseId: z.string().uuid(),
        maxLimit: z.number().int().positive().optional(),
        isActive: z.boolean().optional()
      });
      const body = schema.parse(req.body);
      const baseData = {
        code: body.code.trim().toUpperCase(),
        discountPercent: body.discountPercent,
        courseId: body.courseId,
        isActive: body.isActive ?? true
      };

      // Try with maxLimit if provided, otherwise fallback
      try {
        const data = body.maxLimit ? { ...baseData, maxLimit: body.maxLimit } : baseData;
        const coupon = await prisma.coupon.create({ data });
        return res.json(coupon);
      } catch (e) {
        if (String(e.message || '').includes('Unknown argument `maxLimit`')) {
          const coupon = await prisma.coupon.create({ data: baseData });
          return res.json(coupon);
        }
        throw e;
      }
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(400).json({ success: false, error: { message: 'Coupon code already exists', type: 'Duplicate', timestamp: Date.now() } });
      }
      next(e);
    }
  });

  // Update coupon
  router.put('/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const schema = z.object({
        code: z.string().min(3).optional(),
        discountPercent: z.number().int().min(1).max(100).optional(),
        courseId: z.string().uuid().optional(),
        maxLimit: z.number().int().positive().nullable().optional(),
        isActive: z.boolean().optional()
      });
      const parsed = schema.parse(req.body);
      const baseData = {
        ...parsed,
        ...(parsed.code ? { code: parsed.code.trim().toUpperCase() } : {})
      };

      try {
        const updated = await prisma.coupon.update({ where: { id }, data: baseData });
        return res.json(updated);
      } catch (e) {
        if (String(e.message || '').includes('Unknown argument `maxLimit`')) {
          const { maxLimit, ...withoutMax } = baseData;
          const updated = await prisma.coupon.update({ where: { id }, data: withoutMax });
          return res.json(updated);
        }
        throw e;
      }
    } catch (e) {
      if (e.code === 'P2002') {
        return res.status(400).json({ success: false, error: { message: 'Coupon code already exists', type: 'Duplicate', timestamp: Date.now() } });
      }
      next(e);
    }
  });

  // Delete coupon
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.coupon.delete({ where: { id } });
      res.json({ success: true });
    } catch (e) { next(e); }
  });

  // Toggle active
  router.post('/:id/toggle', async (req, res, next) => {
    try {
      const id = req.params.id;
      const coupon = await prisma.coupon.findUnique({ where: { id } });
      if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
      const updated = await prisma.coupon.update({ where: { id }, data: { isActive: !coupon.isActive } });
      res.json(updated);
    } catch (e) { next(e); }
  });

  return router;
}


