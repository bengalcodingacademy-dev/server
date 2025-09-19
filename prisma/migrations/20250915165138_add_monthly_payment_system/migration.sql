-- AlterTable
ALTER TABLE "public"."Course" ADD COLUMN     "durationMonths" INTEGER,
ADD COLUMN     "isMonthlyPayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyFeeCents" INTEGER;

-- CreateTable
CREATE TABLE "public"."MonthlyPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "upiMobile" TEXT,
    "upiTxnId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyPurchase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."MonthlyPurchase" ADD CONSTRAINT "MonthlyPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MonthlyPurchase" ADD CONSTRAINT "MonthlyPurchase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "public"."Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
