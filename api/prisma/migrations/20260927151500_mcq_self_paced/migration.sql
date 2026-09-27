-- v1.2: multiple choice, self-paced sections, make-a-market templates (additive).

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "choices" JSONB,
ADD COLUMN     "correctChoice" INTEGER,
ADD COLUMN     "market" JSONB;

-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "autoScore" DOUBLE PRECISION,
ADD COLUMN     "choice" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "choiceOrders" JSONB,
ADD COLUMN     "questionOrder" JSONB;
