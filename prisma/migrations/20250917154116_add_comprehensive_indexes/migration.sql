-- CreateIndex
CREATE INDEX "Announcement_courseId_idx" ON "public"."Announcement"("courseId");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "public"."Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "Coupon_courseId_idx" ON "public"."Coupon"("courseId");

-- CreateIndex
CREATE INDEX "Coupon_isActive_idx" ON "public"."Coupon"("isActive");

-- CreateIndex
CREATE INDEX "MeetingRequest_userId_idx" ON "public"."MeetingRequest"("userId");

-- CreateIndex
CREATE INDEX "MeetingRequest_status_idx" ON "public"."MeetingRequest"("status");

-- CreateIndex
CREATE INDEX "MeetingRequest_createdAt_idx" ON "public"."MeetingRequest"("createdAt");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_userId_idx" ON "public"."MonthlyPurchase"("userId");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_courseId_idx" ON "public"."MonthlyPurchase"("courseId");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_status_idx" ON "public"."MonthlyPurchase"("status");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_userId_status_idx" ON "public"."MonthlyPurchase"("userId", "status");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_courseId_monthNumber_idx" ON "public"."MonthlyPurchase"("courseId", "monthNumber");

-- CreateIndex
CREATE INDEX "MonthlyPurchase_dueDate_idx" ON "public"."MonthlyPurchase"("dueDate");

-- CreateIndex
CREATE INDEX "NotificationReceipt_userId_idx" ON "public"."NotificationReceipt"("userId");

-- CreateIndex
CREATE INDEX "NotificationReceipt_userId_isRead_idx" ON "public"."NotificationReceipt"("userId", "isRead");

-- CreateIndex
CREATE INDEX "NotificationReceipt_announcementId_idx" ON "public"."NotificationReceipt"("announcementId");

-- CreateIndex
CREATE INDEX "Testimonial_courseId_idx" ON "public"."Testimonial"("courseId");

-- CreateIndex
CREATE INDEX "Testimonial_isActive_idx" ON "public"."Testimonial"("isActive");

-- CreateIndex
CREATE INDEX "Testimonial_createdAt_idx" ON "public"."Testimonial"("createdAt");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");

-- CreateIndex
CREATE INDEX "User_emailVerifiedAt_idx" ON "public"."User"("emailVerifiedAt");

-- CreateIndex
CREATE INDEX "Webinar_startTime_idx" ON "public"."Webinar"("startTime");

-- CreateIndex
CREATE INDEX "Webinar_createdAt_idx" ON "public"."Webinar"("createdAt");

-- CreateIndex
CREATE INDEX "course_content_courseId_idx" ON "public"."course_content"("courseId");

-- CreateIndex
CREATE INDEX "course_content_courseId_monthNumber_idx" ON "public"."course_content"("courseId", "monthNumber");

-- CreateIndex
CREATE INDEX "course_content_courseId_monthNumber_order_idx" ON "public"."course_content"("courseId", "monthNumber", "order");
