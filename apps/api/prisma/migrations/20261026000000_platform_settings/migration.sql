-- CreateTable
CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL,
    "platform_commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
