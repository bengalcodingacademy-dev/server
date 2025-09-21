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
import { purchasesRouter } from "./routes/purchases.js";
import { webinarsRouter } from "./routes/webinars.js";
import { announcementsRouter } from "./routes/announcements.js";
import { testimonialsRouter } from "./routes/testimonials.js";
import { youtubeVideosRouter } from "./routes/youtubeVideos.js";
import { adminRouter } from "./routes/admin.js";
import { meRouter } from "./routes/me.js";
import { courseContentRouter } from "./routes/courseContent.js";

import { requireAuth, requireAdmin } from "./middleware/auth.js";

const app = express();

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
          "https://admin.bengalcodingacademy.com",
          "https://bengalcodingacademy.com",
          "https://www.bengalcodingacademy.com",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      })
    );
    app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

    // Simple root endpoint for basic connectivity test
    app.get("/", (req, res) => {
      res.json({
        message: "Bengal Coding Academy API Server",
        status: "running",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      });
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
    app.use("/api/courses", coursesRouter(prisma));
    app.use("/api/purchases", requireAuth, purchasesRouter(prisma));
    app.use("/api/webinars", webinarsRouter(prisma));
    app.use("/api/announcements", announcementsRouter(prisma));
    app.use("/api/testimonials", testimonialsRouter(prisma));
    app.use("/api/youtube-videos", youtubeVideosRouter(prisma));
    app.use("/api/me", meRouter(prisma));
    app.use("/api/course-content", requireAuth, courseContentRouter(prisma));

    // Admin scoped
    app.use("/api/admin", requireAuth, requireAdmin, adminRouter(prisma));

    // Global error handler
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      console.error(err);
      const status = err.status || 500;
      res
        .status(status)
        .json({ error: err.message || "Internal Server Error" });
    });

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
