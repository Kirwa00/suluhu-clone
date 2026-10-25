-- CreateTable
CREATE TABLE "payment_provider_settings" (
    "id" UUID NOT NULL,
    "mpesa_mode" TEXT NOT NULL DEFAULT 'mock',
    "payhero_api_username" TEXT,
    "payhero_api_password_enc" TEXT,
    "payhero_channel_id" INTEGER,
    "payhero_base_url" TEXT,
    "mpesa_callback_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_settings_pkey" PRIMARY KEY ("id")
);
