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

// Initialize Prisma client with better error handling
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

// Test database connection on startup
prisma.$connect()
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch((error) => {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  });

// const allowedOrigins = (process.env.APP_URLS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(cookieParser());
// app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(cors({
  origin: [
    'https://bca-web-microfrontend.netlify.app',
    'https://dashing-cobbler-03a3cd.netlify.app',
    'http://localhost:5173',
    'http://localhost:5174', 
    'https://admin.bengalcodingacademy.com',
    'https://bengalcodingacademy.com',
    'https://www.bengalcodingacademy.com'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await prisma.$connect();
    const adminCount = await prisma.admin.count();
    const userCount = await prisma.user.count();
    
    res.json({ 
      ok: true, 
      time: new Date().toISOString(),
      database: 'connected',
      adminCount,
      userCount,
      env: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ 
      ok: false, 
      time: new Date().toISOString(),
      error: error.message,
      database: 'disconnected'
    });
  }
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
const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down gracefully...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down gracefully...');
  await prisma.$disconnect();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});


