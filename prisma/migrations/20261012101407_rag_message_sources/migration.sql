/*
  Warnings:

  - You are about to drop the column `sourceChunkIds` on the `Message` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "RetrievalMode" AS ENUM ('FULL_TEXT', 'MATCHED', 'WEAK_MATCH', 'NO_MATCH', 'NO_DOCUMENTS');

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "sourceChunkIds",
ADD COLUMN     "retrieval" "RetrievalMode";

-- CreateTable
CREATE TABLE "MessageSource" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "chunkId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION,

    CONSTRAINT "MessageSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageSource_chunkId_idx" ON "MessageSource"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageSource_messageId_position_key" ON "MessageSource"("messageId", "position");

-- AddForeignKey
ALTER TABLE "MessageSource" ADD CONSTRAINT "MessageSource_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSource" ADD CONSTRAINT "MessageSource_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
