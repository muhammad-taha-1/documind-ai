import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getDocumentDetail, listDocumentPassages, PASSAGES_PER_PAGE } from "./queries";

let ownerId: string;
let otherUserId: string;

/** A document with `contents.length` chunks, chunk i on page i + 1 */
async function createDocument(userId: string, contents: string[]) {
  const document = await prisma.document.create({
    data: {
      title: "Doc",
      fileName: "d.pdf",
      fileSize: 1,
      filePath: "unused",
      status: "READY",
      userId,
      chunks: {
        create: contents.map((content, i) => ({ content, chunkIndex: i, pageNumber: i + 1 })),
      },
    },
    select: { id: true, chunks: { orderBy: { chunkIndex: "asc" }, select: { id: true } } },
  });
  return { id: document.id, chunkIds: document.chunks.map((chunk) => chunk.id) };
}

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `Passage ${i}`);

beforeAll(async () => {
  const runId = randomUUID();
  ownerId = (await prisma.user.create({ data: { email: `owner-${runId}@test.local` } })).id;
  otherUserId = (await prisma.user.create({ data: { email: `other-${runId}@test.local` } })).id;
});

beforeEach(async () => {
  const users = { userId: { in: [ownerId, otherUserId] } };
  await prisma.conversation.deleteMany({ where: users });
  await prisma.document.deleteMany({ where: users });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherUserId] } } });
  await prisma.$disconnect();
});

describe("getDocumentDetail", () => {
  it("counts the user's chats that include the document", async () => {
    const document = await createDocument(ownerId, ["a"]);
    const other = await createDocument(ownerId, ["b"]);
    await prisma.conversation.createMany({
      data: [
        { userId: ownerId, documentIds: [document.id] },
        { userId: ownerId, documentIds: [other.id, document.id] },
        { userId: ownerId, documentIds: [other.id] },
      ],
    });

    expect(await getDocumentDetail(ownerId, document.id)).toMatchObject({
      id: document.id,
      title: "Doc",
      chatCount: 2,
    });
  });

  it("is null for another user's document", async () => {
    const document = await createDocument(otherUserId, ["a"]);
    expect(await getDocumentDetail(ownerId, document.id)).toBeNull();
  });
});

describe("listDocumentPassages", () => {
  it("pages through the passages in reading order", async () => {
    const document = await createDocument(ownerId, numbered(PASSAGES_PER_PAGE + 5));

    const first = await listDocumentPassages(ownerId, document.id);
    expect(first).toMatchObject({ total: PASSAGES_PER_PAGE + 5, page: 1, pageCount: 2 });
    expect(first.passages).toHaveLength(PASSAGES_PER_PAGE);
    expect(first.passages[0]).toEqual({
      id: document.chunkIds[0],
      content: "Passage 0",
      pageNumber: 1,
      chunkIndex: 0,
    });

    const second = await listDocumentPassages(ownerId, document.id, { page: 2 });
    expect(second.passages.map((passage) => passage.chunkIndex)).toEqual([20, 21, 22, 23, 24]);
  });

  it("shows the nearest real page for out-of-range page numbers", async () => {
    const document = await createDocument(ownerId, numbered(3));
    expect((await listDocumentPassages(ownerId, document.id, { page: 9 })).page).toBe(1);
    expect((await listDocumentPassages(ownerId, document.id, { page: -1 })).page).toBe(1);
  });

  it("opens the page holding a given passage", async () => {
    const document = await createDocument(ownerId, numbered(PASSAGES_PER_PAGE * 2 + 1));

    const result = await listDocumentPassages(ownerId, document.id, {
      chunkId: document.chunkIds[PASSAGES_PER_PAGE * 2],
    });
    expect(result.page).toBe(3);
    expect(result.passages.map((passage) => passage.id)).toEqual([document.chunkIds[PASSAGES_PER_PAGE * 2]]);

    // A passage that's gone (document reprocessed) falls back to the first page
    expect((await listDocumentPassages(ownerId, document.id, { chunkId: "gone" })).page).toBe(1);
  });

  it("finds passages containing the search text, ignoring case", async () => {
    const document = await createDocument(ownerId, [
      "Elastic Load Balancing spreads traffic",
      "Amazon RDS backups",
      "Application LOAD balancer rules",
    ]);

    const result = await listDocumentPassages(ownerId, document.id, { query: "load bal" });

    expect(result.total).toBe(2);
    expect(result.passages.map((passage) => passage.chunkIndex)).toEqual([0, 2]);
  });

  it("treats % and _ in the search text literally", async () => {
    const document = await createDocument(ownerId, ["uptime 99.9% guaranteed", "file_name here", "plain text"]);

    expect((await listDocumentPassages(ownerId, document.id, { query: "%" })).total).toBe(1);
    expect((await listDocumentPassages(ownerId, document.id, { query: "_" })).total).toBe(1);
  });

  it("returns nothing from another user's document", async () => {
    const document = await createDocument(otherUserId, ["secret"]);
    expect(await listDocumentPassages(ownerId, document.id)).toEqual({
      passages: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
  });
});
