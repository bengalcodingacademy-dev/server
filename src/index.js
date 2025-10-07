import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

import { authRouter } from "./routes/auth.js";
import { coursesRouter } from "./routes/courses.js";
// import { purchasesRouter } from "./routes/purchases.js";
import { webinarsRouter } from "./routes/webinars.js";
import { announcementsRouter } from "./routes/announcements.js";
import { testimonialsRouter } from "./routes/testimonials.js";
import { youtubeVideosRouter } from "./routes/youtubeVideos.js";
import { adminRouter } from "./routes/admin.js";
import { meRouter } from "./routes/me.js";
import { courseContentRouter } from "./routes/courseContent.js";
import { visitorsRouter } from "./routes/visitors.js";
import { dmlRouter } from "./routes/dml.js";
import { quizExamRouter } from "./routes/quizExam.js";
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import otpRoutes from "./routes/otp.js";

import { requireAuth, requireAdmin } from "./middleware/auth.js";
import { getRazorpayStatus } from "./services/razorpay.js";
import { errorHandler, AppError, ErrorTypes } from "./middleware/errorHandler.js";

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
import purchasesRouter from "./routes/purchases.js";

const app = express();

// Trust proxy for production (behind load balancer/reverse proxy)
// Only trust the first proxy (load balancer)
app.set('trust proxy', 1);

//Push to DO
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["error"],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Initialize server after database connection
async function startServer() {
  try {
    console.log("🔄 Starting server initialization...");
    console.log(`📋 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🔌 Port: ${process.env.PORT || 4000}`);

    // Test database connection
    await prisma.$connect();
    console.log("✅ Database connected successfully");

    // Setup Express middleware
    app.use(helmet());
    app.use(express.json({ limit: "1mb" }));
    app.use(morgan("dev"));
    app.use(cookieParser());
    app.use(
      cors({
        origin: [
          "http://localhost:5173",
          "http://localhost:5174",
          "http://localhost:5175",
          "https://admin.bengalcodingacademy.com",
          "https://bengalcodingacademy.com",
          "https://www.bengalcodingacademy.com",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      })
    );
    app.use(rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      trustProxy: true,
      skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === '/api/health' || req.path === '/';
      }
    }));

    // Simple root endpoint for basic connectivity test
    app.get("/", (req, res) => {
      res.json({
        message: "Bengal Coding Academy API Server",
        status: "running",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      });
    });

    // Health check endpoint (bypasses rate limiting)
    app.get("/api/health", async (req, res) => {
      try {
        // Test database connection
        await prisma.$queryRaw`SELECT 1`;

        res.json({
          ok: true,
          time: new Date().toISOString(),
          database: "connected",
          adminCount: await prisma.user.count({ where: { role: "ADMIN" } }),
          userCount: await prisma.user.count(),
          env: process.env.NODE_ENV || "development",
          prismaStatus: "INITIALIZED",
          razorpay: {
            configured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
            hasKeyId: !!process.env.RAZORPAY_KEY_ID,
            hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
            instance: true
          }
        });
      } catch (error) {
        res.status(500).json({
          ok: false,
          time: new Date().toISOString(),
          error: error.message,
          database: "disconnected"
        });
      }
    });

    // Handle favicon requests to prevent 404s
    app.get("/favicon.ico", (req, res) => {
      res.status(204).end();
    });

    // Handle common bot requests
    app.get("/ads.txt", (req, res) => {
      res.status(204).end();
    });

    app.get("/app-ads.txt", (req, res) => {
      res.status(204).end();
    });

    app.get("/sellers.json", (req, res) => {
      res.status(204).end();
    });

    // Razorpay status endpoint for debugging
    app.get("/api/razorpay/status", (req, res) => {
      try {
        const status = getRazorpayStatus();
        res.json({
          success: true,
          ...status,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    app.get("/api/health", async (req, res) => {
      try {
        console.log("Sauvik Chatterjee");

        // Test database connection
        await prisma.$connect();
        const userCount = await prisma.user.count();
        const adminCount = await prisma.user.count({
          where: { role: "ADMIN" },
        });

        res.json({
          ok: true,
          time: new Date().toISOString(),
          database: "connected",
          adminCount,
          userCount,
          env: process.env.NODE_ENV || "development",
          prismaStatus: prisma ? "INITIALIZED" : "NOT_INITIALIZED",
          razorpay: getRazorpayStatus(),
        });
      } catch (error) {
        console.error("Health check failed:", error);
        res.status(500).json({
          ok: false,
          time: new Date().toISOString(),
          error: error.message,
          database: "disconnected",
          prismaStatus: prisma ? "INITIALIZED" : "NOT_INITIALIZED",
        });
      }
    });

    // Test endpoint to check Prisma client
    app.get("/api/test-prisma", async (req, res) => {
      try {
        console.log("Testing Prisma client...");
        console.log("Prisma client exists:", prisma ? "YES" : "NO");

        if (!prisma) {
          return res.status(500).json({ error: "Prisma client is undefined" });
        }

        await prisma.$connect();
        const userCount = await prisma.user.count();
        const adminCount = await prisma.user.count({
          where: { role: "ADMIN" },
        });

        res.json({
          success: true,
          prismaClient: "available",
          userCount,
          adminCount,
          message: "Prisma client is working correctly",
        });
      } catch (error) {
        console.error("Prisma test failed:", error);
        res.status(500).json({
          error: error.message,
          prismaClient: prisma ? "available" : "undefined",
        });
      }
    });

    app.use("/api/auth", authRouter(prisma));
    app.use("/api/otp", otpRoutes);
    app.use("/api/courses", coursesRouter(prisma));
    app.use("/api/purchases", requireAuth, purchasesRouter(prisma));
    app.use("/api/webinars", webinarsRouter(prisma));
    app.use("/api/announcements", announcementsRouter(prisma));
    app.use("/api/testimonials", testimonialsRouter(prisma));
    app.use("/api/youtube-videos", youtubeVideosRouter(prisma));
    app.use("/api/visitors", visitorsRouter());
    app.use("/api/me", meRouter(prisma));
    app.use("/api/course-content", requireAuth, courseContentRouter(prisma));

    // Admin scoped
    app.use("/api/admin", requireAuth, requireAdmin, adminRouter(prisma));
    app.use("/api/admin/dml", requireAuth, requireAdmin, dmlRouter(prisma));
    
    // Quiz Exam routes (admin)
    app.use("/api/admin/quiz-exams", requireAuth, requireAdmin, quizExamRouter(prisma));
    
    
    // Public quiz exam routes for students
    app.use("/api/quiz-exams", requireAuth, quizExamRouter(prisma));

// Image upload route for CKEditor
app.post('/api/upload/image', requireAuth, requireAdmin, upload.single('upload'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `quiz-images/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: 'public-read'
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Return CloudFront URL instead of direct S3 URL
    const cloudFrontUrl = `https://d270a3f3iqnh9i.cloudfront.net/${fileName}`;

    res.json({
      url: cloudFrontUrl
    });
  } catch (error) {
    console.error('Image upload error:', error);
    next(error);
  }
});

    // 404 handler - must be before error handler
    app.use((req, res, next) => {
      const error = new AppError(`Not found - ${req.originalUrl}`, 404, ErrorTypes.NOT_FOUND);
      next(error);
    });

    // Global error handler - must be last
    app.use(errorHandler);

    const port = process.env.PORT || 4000;
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Server accessible at http://localhost:${port}`);
      console.log(
        `📊 Health check available at http://localhost:${port}/api/health`
      );
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("🔄 Shutting down gracefully...");
      await prisma.$disconnect();
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    });

    process.on("SIGTERM", async () => {
      console.log("🔄 Shutting down gracefully...");
      await prisma.$disconnect();
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    console.error("Error details:", error.message);
    process.exit(1);
  }
}

// Start the server
startServer();
