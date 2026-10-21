-- AlterTable: por onde cada pedido de impulsionamento é pago (WEB, APPLE ou GOOGLE). Os pedidos existentes são todos da web.
ALTER TABLE "Boost" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'WEB';
