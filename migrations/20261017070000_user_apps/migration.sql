-- CreateTable
CREATE TABLE "UserApp" (
    "id" SERIAL NOT NULL,
    "appId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "UserApp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserApp_userId_appId_key" ON "UserApp"("userId", "appId");

-- AddForeignKey
ALTER TABLE "UserApp" ADD CONSTRAINT "UserApp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: users who already have portfolios keep access to the Portfolio app.
INSERT INTO "UserApp" ("appId", "userId")
SELECT DISTINCT 'portfolio', "userId" FROM "Portfolio";
