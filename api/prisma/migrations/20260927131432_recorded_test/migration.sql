-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "decisionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "candidateAnswer" TEXT,
ADD COLUMN     "candidateAnswerAt" TIMESTAMP(3),
ADD COLUMN     "firstPresentedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentIp" TEXT,
ADD COLUMN     "consentUserAgent" TEXT,
ADD COLUMN     "consentVersion" TEXT,
ADD COLUMN     "extensionMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recordingRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RecordingSegment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastChunkAt" TIMESTAMP(3),
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "chunks" INTEGER NOT NULL DEFAULT 0,
    "remuxedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RecordingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAt" TIMESTAMP(3),
    "questionKey" TEXT,
    "detail" TEXT,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordingSegment_sessionId_startedAt_idx" ON "RecordingSegment"("sessionId", "startedAt");

-- CreateIndex
CREATE INDEX "RecordingSegment_orgId_idx" ON "RecordingSegment"("orgId");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_at_idx" ON "SessionEvent"("sessionId", "at");

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
