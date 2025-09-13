import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';

import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';
import { purchasesRouter } from './routes/purchases.js';
import { webinarsRouter } from './routes/webinars.js';
import { announcementsRouter } from './routes/announcements.js';
import { testimonialsRouter } from './routes/testimonials.js';
import { adminRouter } from './routes/admin.js';
import { meRouter } from './routes/me.js';

import { requireAuth, requireAdmin } from './middleware/auth.js';

const app = express();
const prisma = new PrismaClient();

const allowedOrigins = (process.env.APP_URLS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(cookieParser());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', authRouter(prisma));
app.use('/api/courses', coursesRouter(prisma));
app.use('/api/purchases', requireAuth, purchasesRouter(prisma));
app.use('/api/webinars', webinarsRouter(prisma));
app.use('/api/announcements', announcementsRouter(prisma));
app.use('/api/testimonials', testimonialsRouter(prisma));
app.use('/api/me', requireAuth, meRouter(prisma));

// Admin scoped
app.use('/api/admin', requireAuth, requireAdmin, adminRouter(prisma));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server running on :${port}`);
});


