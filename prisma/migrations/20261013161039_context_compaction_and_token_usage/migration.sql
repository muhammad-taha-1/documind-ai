-- Phase 12: context compaction and per-reply token usage.
-- tokensUsed was one total per reply; it is replaced by separate input/output/
-- cache counts, which an old total cannot be split into, so it is dropped.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "compactedThrough" TIMESTAMP(3),
ADD COLUMN     "compaction" JSONB,
ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "tokensUsed",
ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER,
ADD COLUMN     "contextTokens" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;

