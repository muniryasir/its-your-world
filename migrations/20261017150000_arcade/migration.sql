-- Arcade app: player nicknames, games added per user, and game runs whose
-- scores the server computes by replaying the recorded inputs.

-- CreateTable
CREATE TABLE "ArcadePlayer" (
    "userId" INTEGER NOT NULL,
    "nickname" TEXT NOT NULL,
    "nicknameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArcadePlayer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ArcadeGame" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "ArcadeGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRun" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLAYING',
    "score" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB,
    "ticks" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,

    CONSTRAINT "GameRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcadePlayer_nicknameKey_key" ON "ArcadePlayer"("nicknameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArcadeGame_userId_gameId_key" ON "ArcadeGame"("userId", "gameId");

-- CreateIndex
CREATE INDEX "GameRun_gameId_status_score_idx" ON "GameRun"("gameId", "status", "score");

-- CreateIndex
CREATE INDEX "GameRun_userId_gameId_status_idx" ON "GameRun"("userId", "gameId", "status");

-- AddForeignKey
ALTER TABLE "ArcadePlayer" ADD CONSTRAINT "ArcadePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcadeGame" ADD CONSTRAINT "ArcadeGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRun" ADD CONSTRAINT "GameRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
