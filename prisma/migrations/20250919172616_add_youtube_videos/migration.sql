-- CreateTable
CREATE TABLE "public"."YouTubeVideo" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "duration" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YouTubeVideo_isActive_idx" ON "public"."YouTubeVideo"("isActive");

-- CreateIndex
CREATE INDEX "YouTubeVideo_order_idx" ON "public"."YouTubeVideo"("order");

-- CreateIndex
CREATE INDEX "YouTubeVideo_createdAt_idx" ON "public"."YouTubeVideo"("createdAt");
