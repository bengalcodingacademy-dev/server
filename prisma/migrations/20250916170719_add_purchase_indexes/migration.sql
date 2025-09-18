-- CreateIndex
CREATE INDEX "Course_isActive_idx" ON "public"."Course"("isActive");

-- CreateIndex
CREATE INDEX "Course_slug_idx" ON "public"."Course"("slug");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "public"."Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_userId_createdAt_idx" ON "public"."Purchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_courseId_idx" ON "public"."Purchase"("courseId");

-- CreateIndex
CREATE INDEX "Purchase_status_idx" ON "public"."Purchase"("status");

-- CreateIndex
CREATE INDEX "Purchase_userId_status_idx" ON "public"."Purchase"("userId", "status");
