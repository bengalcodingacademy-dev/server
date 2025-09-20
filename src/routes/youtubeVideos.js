import express from 'express';
import { z } from 'zod';

const createYouTubeVideoSchema = z.object({
  title: z.string().min(1),
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  isActive: z.boolean().optional()
});

const updateYouTubeVideoSchema = z.object({
  title: z.string().min(1).optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  isActive: z.boolean().optional()
});

export function youtubeVideosRouter(prisma) {
  const router = express.Router();

  // Get all YouTube videos (public endpoint)
  router.get('/', async (req, res, next) => {
    try {
      const videos = await prisma.youTubeVideo.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          videoUrl: true,
          thumbnailUrl: true
        }
      });
      
      res.set('Cache-Control', 'private, max-age=300'); // Cache for 5 minutes
      res.json(videos);
    } catch (e) {
      next(e);
    }
  });

  // Get all YouTube videos (admin endpoint)
  router.get('/admin', async (req, res, next) => {
    try {
      const videos = await prisma.youTubeVideo.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          videoUrl: true,
          thumbnailUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      });
      
      res.json(videos);
    } catch (e) {
      next(e);
    }
  });

  // Create new YouTube video (admin only)
  router.post('/', async (req, res, next) => {
    try {
      const data = createYouTubeVideoSchema.parse(req.body);
      const video = await prisma.youTubeVideo.create({ data });
      res.status(201).json(video);
    } catch (e) {
      next(e);
    }
  });

  // Update YouTube video (admin only)
  router.put('/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      const data = updateYouTubeVideoSchema.parse(req.body);
      const video = await prisma.youTubeVideo.update({
        where: { id },
        data
      });
      res.json(video);
    } catch (e) {
      next(e);
    }
  });

  // Delete YouTube video (admin only)
  router.delete('/:id', async (req, res, next) => {
    try {
      const id = req.params.id;
      await prisma.youTubeVideo.delete({ where: { id } });
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
