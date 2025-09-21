-- AlterTable
ALTER TABLE "public"."Purchase" ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "razorpaySignature" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Purchase_razorpayOrderId_idx" ON "public"."Purchase"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Purchase_razorpayPaymentId_idx" ON "public"."Purchase"("razorpayPaymentId");
