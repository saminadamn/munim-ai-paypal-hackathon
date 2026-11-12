-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "avgDaysLate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStyle" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceMeta" (
    "paypalId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'paypal',
    "rawInput" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "allowPartial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "paypalInvoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "actionType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "guardrail" TEXT,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "proposed" INTEGER NOT NULL DEFAULT 0,
    "executed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "businessName" TEXT NOT NULL DEFAULT 'My business',
    "ownerName" TEXT NOT NULL DEFAULT 'Owner',
    "demoOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "maxRemindersPerInvoice" INTEGER NOT NULL DEFAULT 3,
    "minDaysBetweenReminders" INTEGER NOT NULL DEFAULT 3,
    "approvalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "quietWeekends" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "ms" INTEGER NOT NULL,
    "debugId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_email_key" ON "ClientProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceMeta_paypalId_key" ON "InvoiceMeta"("paypalId");

-- CreateIndex
CREATE INDEX "AgentAction_paypalInvoiceId_createdAt_idx" ON "AgentAction"("paypalInvoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_status_idx" ON "AgentAction"("status");

-- CreateIndex
CREATE INDEX "ApiLog_createdAt_idx" ON "ApiLog"("createdAt");
