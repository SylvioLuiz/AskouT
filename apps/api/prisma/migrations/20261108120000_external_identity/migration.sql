-- Login com Google e Apple: a conta externa liga a uma conta do AskouT pelo ID fixo da plataforma.
CREATE TABLE "ExternalIdentity" (
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("provider","subject")
);
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity"("userId");
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
