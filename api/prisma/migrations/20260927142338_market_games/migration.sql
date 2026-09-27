-- AlterTable
-- Question.market is added by 20260927151500_mcq_self_paced.

-- CreateTable
CREATE TABLE "MarketGame" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "rolls" JSONB,
    "trueValue" DOUBLE PRECISION NOT NULL,
    "revealCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketQuote" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "bid" DOUBLE PRECISION NOT NULL,
    "ask" DOUBLE PRECISION NOT NULL,
    "size" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealsSoFar" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketTrade" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "quoteId" TEXT,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "size" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketGame_sessionId_startedAt_idx" ON "MarketGame"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "MarketQuote_gameId_at_idx" ON "MarketQuote"("gameId", "at");

-- CreateIndex
CREATE INDEX "MarketTrade_gameId_at_idx" ON "MarketTrade"("gameId", "at");

-- AddForeignKey
ALTER TABLE "MarketGame" ADD CONSTRAINT "MarketGame_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketQuote" ADD CONSTRAINT "MarketQuote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "MarketGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketTrade" ADD CONSTRAINT "MarketTrade_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "MarketGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketTrade" ADD CONSTRAINT "MarketTrade_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "MarketQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
