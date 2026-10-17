-- Portfolio becomes a simulator: demo cash, holdings tied to the market
-- catalog, and a trade history. The old free-text Investment rows can't be
-- mapped onto catalog assets, so they are dropped (demo data only).

-- DropForeignKey
ALTER TABLE "Investment" DROP CONSTRAINT "Investment_portfolioId_fkey";

-- DropTable
DROP TABLE "Investment";

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "cash" DECIMAL(20,4) NOT NULL DEFAULT 100000,
ADD COLUMN     "startingCash" DECIMAL(20,4) NOT NULL DEFAULT 100000;

-- CreateTable
CREATE TABLE "Holding" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "costBasis" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "portfolioId" INTEGER NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(20,8) NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "total" DECIMAL(20,4) NOT NULL,
    "realizedGain" DECIMAL(20,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "portfolioId" INTEGER NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_symbol_key" ON "Holding"("portfolioId", "symbol");

-- CreateIndex
CREATE INDEX "Trade_portfolioId_createdAt_idx" ON "Trade"("portfolioId", "createdAt");

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
