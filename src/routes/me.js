import express from 'express';

export function meRouter(prisma) {
  const router = express.Router();

  router.get('/summary', async (req, res, next) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { purchases: { include: { course: true } } } });
      const totalPaid = user.purchases.filter(p=>p.status==='PAID').reduce((a,b)=>a + b.amountCents, 0);
      const courses = user.purchases.filter(p=>p.status==='PAID').map(p=>({ id: p.course.id, title: p.course.title }));
      const status = user.purchases.length === 0 ? 'NEW' : (courses.length > 0 ? 'ENROLLED' : 'PENDING');
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

  return router;
}


