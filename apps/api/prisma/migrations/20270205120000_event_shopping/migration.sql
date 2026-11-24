-- Lista de compras e divisão de gastos dos eventos criados por pessoas (opcional, ligada por quem criou o evento).
CREATE TABLE "EventShopping" (
    "eventPostId" UUID NOT NULL,
    "membersCanAdd" BOOLEAN NOT NULL DEFAULT true,
    "membersCanCheck" BOOLEAN NOT NULL DEFAULT true,
    "splitExcludedIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventShopping_pkey" PRIMARY KEY ("eventPostId")
);

CREATE TABLE "EventShoppingItem" (
    "id" UUID NOT NULL,
    "eventPostId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "quantity" TEXT,
    "createdById" UUID NOT NULL,
    "boughtById" UUID,
    "boughtAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventShoppingItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventExpense" (
    "id" UUID NOT NULL,
    "eventPostId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "fileName" TEXT,
    "mime" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA,
    "amountCents" INTEGER,
    "payerId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventShoppingItem_eventPostId_createdAt_idx" ON "EventShoppingItem"("eventPostId", "createdAt");
CREATE INDEX "EventExpense_eventPostId_createdAt_idx" ON "EventExpense"("eventPostId", "createdAt");

ALTER TABLE "EventShopping" ADD CONSTRAINT "EventShopping_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventShoppingItem" ADD CONSTRAINT "EventShoppingItem_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "EventShopping"("eventPostId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventExpense" ADD CONSTRAINT "EventExpense_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "EventShopping"("eventPostId") ON DELETE CASCADE ON UPDATE CASCADE;
