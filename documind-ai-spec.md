# DocuMind AI — Project Specification

## Overview

DocuMind AI is an AI-powered document chat assistant. Users upload PDF documents, and the app processes them into searchable chunks with vector embeddings. Users can then have intelligent conversations with their documents using Claude, which retrieves relevant context via RAG (Retrieval-Augmented Generation), streams responses in real-time, and uses tool calling to search, cite, and reason over the uploaded knowledge base.

Think of it as a mini NotebookLM / ChatPDF clone — built to learn every major AI integration pattern.

## What You'll Learn

By building this project, you will gain hands-on experience with:

- **LLM API Integration** — Calling Claude's Messages API directly
- **Streaming Responses** — Real-time token-by-token response rendering
- **Prompt Engineering** — System prompts, context injection, instruction design
- **RAG (Retrieval-Augmented Generation)** — The full pipeline: chunking → embedding → vector search → augmented prompting
- **Embeddings & Vector Search** — Generating embeddings, storing them in pgvector, cosine similarity search
- **Tool/Function Calling** — Defining tools Claude can invoke, handling tool results, multi-step reasoning
- **Multi-turn Conversations** — Managing chat history, context windows, token budgets
- **AI Vision** — Sending images to Claude for analysis
- **Error Handling & Rate Limiting** — Production patterns for AI APIs
- **Token Management** — Tracking usage and managing costs

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions, Route Handlers) — note: `middleware.ts` is now `proxy.ts` |
| Language | TypeScript |
| Database | PostgreSQL + pgvector extension (Docker: `pgvector/pgvector:pg16`) |
| ORM | Prisma 7 (driver adapter `@prisma/adapter-pg`, client generated to `src/generated/prisma`) |
| Auth | NextAuth.js v4 (GitHub provider, JWT session strategy) |
| Testing | Vitest (unit tests for chunker, context builder, tool execution) |
| AI (LLM) | Anthropic Claude API (`@anthropic-ai/sdk`) |
| AI (Embeddings) | OpenAI Embeddings API (`text-embedding-3-small`) — Anthropic doesn't offer an embedding model, so we use OpenAI just for this. It costs ~$0.02 per million tokens, essentially free for learning. |
| Streaming | Anthropic SDK's native `messages.stream()` piped into a web `ReadableStream` (no extra streaming library — you learn the mechanics directly) |
| PDF Parsing | `pdf-parse` v2 (`PDFParse` class — ships its own types, gives real per-page text) |
| UI | Tailwind CSS + shadcn/ui |
| File Upload | Local filesystem (uploadthing or manual with formdata) |

## Environment Variables

```env
# Database (matches docker-compose.yml)
DATABASE_URL="postgresql://documind:documind@localhost:5432/documind?schema=public"

# Auth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"
GITHUB_ID="your-github-oauth-id"
GITHUB_SECRET="your-github-oauth-secret"

# AI — Anthropic (LLM for chat)
ANTHROPIC_API_KEY="sk-ant-..."

# AI — OpenAI (only for embeddings, nothing else)
OPENAI_API_KEY="sk-..."
```

---

## Phase 1: Project Setup & Dependencies

### Goal
Scaffold the Next.js project and install all dependencies.

### Steps

1. Initialize a new Next.js project:
   ```bash
   npx create-next-app@latest documind-ai --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
   ```

2. Install core dependencies:
   ```bash
   # AI SDKs
   npm install @anthropic-ai/sdk openai

   # Database (Prisma 7 needs a driver adapter)
   npm install prisma @prisma/client @prisma/adapter-pg pg dotenv
   npm install -D @types/pg
   npm install pgvector  # pgvector support for Prisma raw queries

   # Auth
   npm install next-auth@4 @auth/prisma-adapter

   # PDF Processing (v2 ships its own types — do NOT install @types/pdf-parse, those are for v1)
   npm install pdf-parse

   # Testing
   npm install -D vitest

   # UI Components
   npx shadcn@latest init
   npx shadcn@latest add button input card dialog scroll-area badge separator skeleton textarea tabs avatar dropdown-menu toast alert sheet progress

   # Utilities
   npm install lucide-react date-fns zod uuid
   npm install @types/uuid --save-dev
   ```

3. Create the project folder structure:
   ```
   src/
   ├── app/
   │   ├── (auth)/
   │   │   └── login/
   │   │       └── page.tsx
   │   ├── (dashboard)/
   │   │   ├── layout.tsx
   │   │   ├── dashboard/
   │   │   │   └── page.tsx          # Dashboard (/dashboard) — list documents
   │   │   ├── documents/
   │   │   │   └── [id]/
   │   │   │       └── page.tsx      # Single document view
   │   │   └── chat/
   │   │       ├── page.tsx          # New chat
   │   │       └── [id]/
   │   │           └── page.tsx      # Existing conversation
   │   ├── api/
   │   │   ├── auth/[...nextauth]/
   │   │   │   └── route.ts
   │   │   ├── documents/
   │   │   │   ├── route.ts          # Upload & list documents
   │   │   │   └── [id]/
   │   │   │       └── route.ts      # Single document operations
   │   │   ├── chat/
   │   │   │   ├── route.ts          # Send message (streaming)
   │   │   │   └── conversations/
   │   │   │       └── route.ts      # CRUD conversations
   │   │   └── embeddings/
   │   │       └── route.ts          # Generate embeddings for a document
   │   └── layout.tsx
   ├── components/
   │   ├── chat/
   │   │   ├── ChatWindow.tsx
   │   │   ├── MessageBubble.tsx
   │   │   ├── ChatInput.tsx
   │   │   ├── SourceCard.tsx
   │   │   └── ToolCallDisplay.tsx
   │   ├── documents/
   │   │   ├── DocumentUpload.tsx
   │   │   ├── DocumentCard.tsx
   │   │   └── DocumentList.tsx
   │   ├── layout/
   │   │   ├── Sidebar.tsx
   │   │   ├── Header.tsx
   │   │   └── AppShell.tsx
   │   └── ui/                       # shadcn components go here
   ├── lib/
   │   ├── ai/
   │   │   ├── anthropic.ts          # Claude client & helpers
   │   │   ├── embeddings.ts         # OpenAI embedding generation
   │   │   ├── rag.ts                # RAG pipeline (search → context → prompt)
   │   │   ├── tools.ts              # Tool definitions for function calling
   │   │   └── prompts.ts            # System prompts & prompt templates
   │   ├── db/
   │   │   └── prisma.ts             # Prisma client singleton
   │   ├── documents/
   │   │   ├── parser.ts             # PDF text extraction
   │   │   └── chunker.ts            # Text chunking logic
   │   ├── auth.ts                   # NextAuth config
   │   └── utils.ts                  # General utilities
   ├── hooks/
   │   ├── useChat.ts                # Custom chat hook
   │   └── useDocuments.ts           # Document management hook
   └── types/
       └── index.ts                  # Shared TypeScript types
   ```

4. Set up environment variables in `.env.local` (copy from the Environment Variables section above).

5. Create a `.env.example` file with placeholder values for GitHub documentation.

6. Create `docker-compose.yml` for PostgreSQL + pgvector (see Phase 15 for the file) and `vitest.config.mts` (unit) + `vitest.integration.config.mts` (database tests) with the `@/` alias. Add `test`, `test:integration` and `db:*` scripts to `package.json`.

### Deliverable
A clean Next.js project with all dependencies installed, folder structure created, and environment variables configured. The app should run with `npm run dev` without errors (just showing the default page). `npx tsc --noEmit`, `npm run lint`, and `npm test` all pass.

### Testing Convention (applies to every phase)
Every phase ends with: `npx tsc --noEmit`, `npm run lint`, `npm test`, plus a manual check of the phase deliverable. Pure logic (chunker, context builder, tool execution, citation parsing) gets `*.test.ts` unit tests next to the source file.

---

## Phase 2: Database Schema & pgvector Setup

### Goal
Design the database schema and set up PostgreSQL with the pgvector extension for vector similarity search.

### Key Concept — Why pgvector?
pgvector is a PostgreSQL extension that adds vector data types and similarity search operators. Instead of needing a separate vector database (like Pinecone or Weaviate), we can store embeddings right alongside our relational data. Since you already know PostgreSQL, this is the natural choice.

### Steps

1. Start the database (Docker Desktop must be running):
   ```bash
   docker compose up -d
   ```

2. pgvector is enabled by the `extensions = [vector]` line in the datasource below — Prisma writes `CREATE EXTENSION IF NOT EXISTS "vector"` into the first migration for you.

3. Define the Prisma schema (`prisma/schema.prisma`). Prisma 7 reads the connection URL from `prisma7.config.ts`, not from the schema:

   ```prisma
   generator client {
     provider        = "prisma-client"
     output          = "../src/generated/prisma"
     previewFeatures = ["postgresqlExtensions"]
   }

   datasource db {
     provider   = "postgresql"
     extensions = [vector]
   }

   model User {
     id            String         @id @default(cuid())
     name          String?
     email         String?        @unique
     emailVerified DateTime?
     image         String?
     accounts      Account[]
     sessions      Session[]
     documents     Document[]
     conversations Conversation[]
     createdAt     DateTime       @default(now())
     updatedAt     DateTime       @updatedAt
   }

   // NextAuth required models
   model Account {
     id                String  @id @default(cuid())
     userId            String
     type              String
     provider          String
     providerAccountId String
     refresh_token     String? @db.Text
     access_token      String? @db.Text
     expires_at        Int?
     token_type        String?
     scope             String?
     id_token          String? @db.Text
     session_state     String?
     user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

     @@unique([provider, providerAccountId])
   }

   model Session {
     id           String   @id @default(cuid())
     sessionToken String   @unique
     userId       String
     expires      DateTime
     user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
   }

   model VerificationToken {
     identifier String
     token      String   @unique
     expires    DateTime

     @@unique([identifier, token])
   }

   model Document {
     id          String          @id @default(cuid())
     title       String
     fileName    String
     fileSize    Int             // in bytes
     mimeType    String          @default("application/pdf")
     filePath    String          // where the file is stored on disk
     pageCount   Int?
     status      DocumentStatus  @default(UPLOADING)
     errorMessage    String?     // why processing failed (e.g. "image-only PDF")
     totalChunks     Int         @default(0) // for "Embedding 15/45 chunks..." progress
     embeddedChunks  Int         @default(0)
     userId      String
     user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
     chunks      DocumentChunk[]
     createdAt   DateTime        @default(now())
     updatedAt   DateTime        @updatedAt

     @@index([userId])
   }

   enum DocumentStatus {
     UPLOADING
     PROCESSING   // extracting text, chunking
     EMBEDDING    // generating embeddings
     READY        // fully processed, ready for chat
     ERROR
   }

   model DocumentChunk {
     id         String   @id @default(cuid())
     content    String   @db.Text        // the actual text content
     pageNumber Int?                     // which page this came from
     chunkIndex Int                      // order within the document
     tokenCount Int?                     // approximate token count
     documentId String
     document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
     // Prisma can't read/write vector columns through its normal API, but declaring it as
     // Unsupported keeps it in the schema so `migrate dev` doesn't see it as drift and
     // offer to reset the database. Reads/writes go through $queryRaw / $executeRaw.
     // 1536 dimensions = text-embedding-3-small
     embedding  Unsupported("vector(1536)")?
     createdAt  DateTime @default(now())

     @@index([documentId])
   }

   model Conversation {
     id         String    @id @default(cuid())
     title      String    @default("New Chat")
     userId     String
     user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
     messages   Message[]
     // Which documents are attached to this conversation
     documentIds String[] // array of document IDs this chat can access
     createdAt  DateTime  @default(now())
     updatedAt  DateTime  @updatedAt

     @@index([userId])
   }

   model Message {
     id             String       @id @default(cuid())
     role           MessageRole
     content        String       @db.Text
     conversationId String
     conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
     // Metadata for AI responses
     model          String?      // which model generated this
     tokensUsed     Int?         // input + output tokens
     // For RAG — which chunks were used as context
     sourceChunkIds String[]     // IDs of DocumentChunks used
     // For tool calls
     toolCalls      Json?        // store tool call data
     toolResults    Json?        // store tool results
     // For vision (Phase 14) — e.g. [{ type: "image", path: "...", mediaType: "image/png" }]
     attachments    Json?
     createdAt      DateTime     @default(now())

     @@index([conversationId])
   }

   enum MessageRole {
     user
     assistant
     system
   }
   ```

4. Run the initial migration (creates tables, the extension, and the `embedding` column):
   ```bash
   npx prisma migrate dev --name init
   ```

5. **No vector index (deliberately).** Without an index, pgvector does an exact nearest-neighbour scan, which has perfect recall and takes milliseconds at this project's scale (thousands of chunks). Two reasons not to add HNSW/IVFFlat here:
   - **Filtered search:** our queries filter by `userId` and `documentIds`. Approximate indexes find the nearest K vectors *first* and filter *after*, so a query scoped to one user's documents can return fewer than K results — or none. Exact search has no such problem.
   - **Prisma can't declare vector indexes.** An index created in a hand-written migration isn't in `schema.prisma`, so the next `migrate dev` generates `DROP INDEX` and silently removes it.

   If you ever need one (roughly 100k+ chunks), put vectors in a separate Postgres schema that Prisma doesn't manage, and look at pgvector's iterative index scans for filtered queries.

6. Update the Prisma client singleton (`src/lib/db/prisma.ts`) to pass the connection string to `PrismaPg` directly, so the adapter owns the pool and `$disconnect()` closes it.

7. Write an integration test (`src/lib/db/pgvector.integration.test.ts`, run with `npm run test:integration`) that uses hand-made 1536-dim vectors with known cosine similarities (no API credits needed). It should prove that writing via `$executeRaw` works, that `$queryRaw` search returns correct ordering and scores, that unembedded chunks are skipped, that another user's chunks are never returned, and that deletes cascade.

**Gotcha:** `prisma migrate dev` prompts for a migration name when the schema has changed, and hangs in non-interactive shells. Always pass `--name`.

### Deliverable
Database fully set up with all tables and the `embedding vector(1536)` column on DocumentChunk. `npx prisma migrate status` reports up to date, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` prints an empty migration (no drift), and the integration tests pass.

---

## Phase 3: Authentication

### Goal
Set up NextAuth with GitHub (or Google) provider, protect dashboard routes.

### Notes
Since you've done this before in your SaaS starter kit, keep this phase quick. Just wire up NextAuth with the Prisma adapter.

### Steps

1. `@auth/prisma-adapter` was installed in Phase 1. Create a GitHub OAuth app (free) at github.com → Settings → Developer settings → OAuth Apps, with callback URL `http://localhost:3000/api/auth/callback/github`.

2. Configure NextAuth in `src/lib/auth.ts`:
   - Use the PrismaAdapter (stores users/accounts in the DB)
   - Set `session: { strategy: "jwt" }` — with an adapter the default is database sessions, which the route-protection proxy can't read (it only sees the cookie/JWT)
   - Add GitHub provider
   - Include user ID in the session via the `session` callback — NextAuth already stores the database `User.id` in the JWT's `sub` claim, so no `jwt` callback is needed. Augment the `Session` type in `src/types/next-auth.d.ts`.

3. Create the API route `src/app/api/auth/[...nextauth]/route.ts`.

4. Create a simple login page at `src/app/(auth)/login/page.tsx`:
   - Clean minimal design with a "Sign in with GitHub" button
   - Redirect to dashboard after login
   - Sanitize `callbackUrl` (`src/lib/safe-redirect.ts`) — it comes from the query string, so redirecting to it unchecked is an open redirect
   - The dashboard lives at `src/app/(dashboard)/dashboard/page.tsx` (URL `/dashboard`; route groups add no URL segment). `/` redirects there. Phase 3 adds a placeholder with a sign-out button.

5. Create `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; read `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`) to protect `/dashboard`, `/chat`, and `/documents` routes — redirect to `/login` if not authenticated. Use next-auth's `withAuth` and export it as `proxy`.
   - The proxy is only a first gate. Every API route must still call `getSession()` (from `src/lib/auth.ts`, a wrapper around `getServerSession(authOptions)`) and check ownership of whatever it reads/writes.
   - `withAuth` doesn't read `authOptions`, so pass `pages: { signIn: "/login" }` to it as well.

6. Create a `SessionProvider` wrapper in a client component and add it to the root layout.

### Deliverable
Working authentication — users can sign in with GitHub and are redirected to the dashboard. Unauthenticated users are redirected to login.

---

## Phase 4: Document Upload & Storage

### Goal
Build the document upload flow — drag & drop UI, file validation, storage to disk, and database record creation.

### Steps

1. Create the upload API route `src/app/api/documents/route.ts`:
   - Accept `multipart/form-data` with a PDF file
   - Validate: only PDFs, max 10MB
   - Save the file to `./uploads/{userId}/{documentId}.pdf` (create the directory if needed)
   - Create a `Document` record in the database with status `UPLOADING`
   - Return the document ID

2. Create the `DocumentUpload` component (`src/components/documents/DocumentUpload.tsx`):
   - Drag & drop zone with visual feedback (dashed border, icon changes on drag)
   - Also support click-to-browse
   - Show upload progress
   - File type & size validation on the client side before uploading
   - After successful upload, show a success state and trigger processing

3. Create the `DocumentCard` component for displaying a document in the list:
   - Show file name, upload date, page count, file size
   - Show processing status with a badge (Uploading → Processing → Embedding → Ready → Error)
   - "Ready" status gets a green badge

4. Create the `DocumentList` component and the dashboard page (`src/app/(dashboard)/dashboard/page.tsx`, replacing the Phase 3 placeholder):
   - List all user's documents
   - Empty state with upload CTA
   - Grid or list layout

5. Create the GET endpoint in `src/app/api/documents/route.ts` to list user's documents.

6. Add a `.gitignore` entry for the `uploads/` directory.

### Implementation notes
- **Validate content, not labels.** The MIME type and extension are chosen by the client; the server checks for the `%PDF-` signature (`src/lib/documents/validation.ts`, shared with the client for fast feedback).
- **Bound the body before reading it.** Route handlers have no body size limit and `request.formData()` buffers everything, so the route rejects a missing (411) or oversized (413) `Content-Length` first.
- **No orphans.** The document ID is a UUID generated before the insert, so the file is written to its final path first; if the insert fails, the file is deleted.
- **`filePath` is a storage key** (`{userId}/{documentId}.pdf`, relative to `UPLOAD_DIR`, default `./uploads`), resolved by `src/lib/documents/storage.ts`, which refuses keys that escape the upload root. Moving the folder needs no data migration.
- **Responses use `DocumentSummary`** (`src/types`) via an explicit Prisma `select` — `filePath`/`userId` never leave the server.
- The dashboard Server Component reads the list with `listDocuments()` directly (no HTTP round trip); `useDocuments` takes over on the client. Upload progress uses `XMLHttpRequest`, since `fetch` has no upload-progress events.
- The "trigger processing" step is wired in Phase 5 — until then, new documents stay `UPLOADING` (shown as a static "Uploaded" badge — the file is stored and waiting for processing).

### Deliverable
Users can upload PDF files via drag & drop, files are saved to disk, and document records appear in the dashboard with status indicators.

---

## Phase 5: PDF Processing & Text Extraction

### Goal
Extract text content from uploaded PDFs and store the raw text.

### Key Concept — Why extract text?
LLMs work with text, not binary PDF data. We need to pull the readable text out of the PDF so we can later chunk it and create embeddings.

### Steps

1. Create the PDF parser (`src/lib/documents/parser.ts`) using the pdf-parse **v2** API:
   ```typescript
   import { PDFParse } from 'pdf-parse';
   import fs from 'fs/promises';

   export interface ParsedPage {
     pageNumber: number;
     text: string;
   }

   export interface ParsedDocument {
     text: string;
     pageCount: number;
     pages: ParsedPage[];
   }

   export async function parsePDF(filePath: string): Promise<ParsedDocument> {
     const data = await fs.readFile(filePath);
     const parser = new PDFParse({ data });
     try {
       const result = await parser.getText();
       return {
         text: result.text,
         pageCount: result.total,
         pages: result.pages.map((p) => ({ pageNumber: p.num, text: p.text })),
       };
     } finally {
       await parser.destroy(); // release the underlying pdf.js document
     }
   }
   ```

2. v2 gives exact per-page text, so page numbers on chunks will be accurate (no approximation needed). If every page's text is empty, the PDF is probably scanned images — set status `ERROR` with `errorMessage: "No extractable text — this PDF may be image-only"`.

3. Create a processing API route `src/app/api/documents/[id]/process/route.ts` (POST):
   - Load the document record, verify ownership
   - Update status to `PROCESSING`
   - Read the PDF file from disk
   - Extract text using the parser
   - Update the document's `pageCount`
   - Pass extracted text to the chunking step (Phase 6)
   - If any error occurs, set status to `ERROR`

4. Wire up: after a successful upload in Phase 4, automatically trigger processing.

### Implementation notes
- **Add `serverExternalPackages: ["pdf-parse"]` to `next.config.ts`.** pdf.js loads its worker from a separate file at runtime; bundling leaves that file behind and every parse fails in `next build` output with "Setting up fake worker failed". Tests and plain Node don't show this — only the production build does.
- **Build the full text from `pages`, not `result.text`** — the latter inserts `-- 1 of 3 --` markers that would end up inside chunks.
- `parsePdf(bytes)` takes bytes instead of a path (testable, storage-agnostic). Known pdf.js errors (`InvalidPDFException`, `PasswordException`, `FormatError`) become a `PdfParseError` with a user-facing message; anything else is rethrown and logged, so environment bugs aren't blamed on the user's file.
- **Processing starts server-side** via `after()` in the upload route, so it still runs if the user closes the tab. `POST /api/documents/[id]/process` is for retries (202 Accepted; 409 if already running; 404 for other users' documents).
- **Atomic claim:** `claimDocumentForProcessing` is one conditional `UPDATE … WHERE status IN (UPLOADING, ERROR) AND userId = …`, so concurrent requests can't start the pipeline twice.
- `runProcessing` never throws — failures land on the document as `ERROR` + `errorMessage`. Error cards show a **Retry** button.
- `useDocuments` polls `GET /api/documents` every 2 s while any document is UPLOADING/PROCESSING/EMBEDDING, and drops poll results that started before a local change.
- Until Phase 6 lands, documents stop at `PROCESSING` with `pageCount` set.
- Known gap: a server restart mid-processing leaves a document stuck in PROCESSING. Handle stale claims in Phase 15.

### Deliverable
Uploaded PDFs are parsed and their text content is extracted. The document status progresses from `UPLOADING` to `PROCESSING`.

---

## Phase 6: Text Chunking

### Goal
Split extracted document text into smaller, overlapping chunks suitable for embedding and retrieval.

### Key Concept — Why chunk?
LLMs have limited context windows. Embedding an entire 50-page document as one vector would lose all nuance. Instead, we break documents into small chunks (~500 tokens each) so that when a user asks a question, we can find and retrieve just the most relevant pieces.

**Overlap** between chunks ensures that information at chunk boundaries isn't lost. If a key sentence spans two chunks, the overlap catches it in at least one.

### Steps

1. Create the text chunker (`src/lib/documents/chunker.ts`):

   ```typescript
   export interface TextChunk {
     content: string;
     chunkIndex: number;
     pageNumber?: number;
     tokenCount: number;
   }

   export interface ChunkingOptions {
     chunkSize: number;     // target size in characters (~4 chars ≈ 1 token)
     chunkOverlap: number;  // overlap between chunks in characters
   }

   const DEFAULT_OPTIONS: ChunkingOptions = {
     chunkSize: 1500,     // ~375 tokens
     chunkOverlap: 200,   // ~50 tokens overlap
   };
   ```

2. Implement a recursive text splitter:
   - First try to split on paragraph breaks (`\n\n`)
   - If chunks are still too large, split on sentence boundaries (`. `)
   - If still too large, split on word boundaries
   - Apply overlap: each chunk starts `chunkOverlap` characters before its natural start (except the first chunk)
   - Estimate token count: `Math.ceil(content.length / 4)` is a rough approximation

3. Store chunks in the database:
   - After chunking, create `DocumentChunk` records for each chunk
   - Store: content, chunkIndex, approximate pageNumber, tokenCount, linked documentId

4. Integrate with the processing pipeline:
   - After text extraction (Phase 5), immediately chunk the text
   - Save all chunks to the database
   - Update document status to `EMBEDDING` (ready for the next phase)

### Deliverable
Documents are split into overlapping text chunks stored in the database. A 10-page PDF might produce 30-60 chunks depending on content density.

---

## Phase 7: Embedding Generation & Vector Storage

### Goal
Generate vector embeddings for each document chunk using OpenAI's embedding API and store them in pgvector.

### Key Concept — What are embeddings?
An embedding is a list of numbers (a vector) that represents the "meaning" of a piece of text. Similar texts have similar vectors. By converting both document chunks AND user questions into vectors, we can find the most relevant chunks by calculating vector similarity (cosine similarity).

We use OpenAI's `text-embedding-3-small` model (1536 dimensions) because:
- Anthropic doesn't offer an embedding model
- It's the industry standard, very cheap ($0.02/million tokens)
- Works perfectly with pgvector
- This teaches you multi-provider integration (a real-world pattern)

### Steps

1. Create the embedding client (`src/lib/ai/embeddings.ts`):
   ```typescript
   import OpenAI from 'openai';

   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

   export async function generateEmbedding(text: string): Promise<number[]> {
     const response = await openai.embeddings.create({
       model: 'text-embedding-3-small',
       input: text,
     });
     return response.data[0].embedding;
   }

   export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
     const response = await openai.embeddings.create({
       model: 'text-embedding-3-small',
       input: texts,
     });
     return response.data.map(d => d.embedding);
   }
   ```

2. Create a function to store embeddings using Prisma raw SQL (since Prisma doesn't support the vector type natively):
   ```typescript
   import { prisma } from '@/lib/db/prisma';

   export async function storeChunkEmbedding(chunkId: string, embedding: number[]) {
     const vectorString = `[${embedding.join(',')}]`;
     // Tagged-template $executeRaw parameterizes every ${} value — never use the
     // *Unsafe variants with string-built SQL.
     await prisma.$executeRaw`
       UPDATE "DocumentChunk" SET embedding = ${vectorString}::vector WHERE id = ${chunkId}
     `;
   }
   ```

3. Create the embedding pipeline in `src/app/api/embeddings/route.ts`:
   - Accept a document ID
   - Fetch all chunks for that document
   - Batch chunks (OpenAI allows up to 2048 inputs per request, but batch in groups of 20 for reliability)
   - Generate embeddings for each batch
   - Store each embedding in the database using raw SQL
   - Update document status to `READY`
   - Handle errors: if embedding fails for some chunks, retry; if persistent failure, set status to `ERROR`

4. Integrate into the processing pipeline:
   - After chunking (Phase 6), set `totalChunks` and trigger embedding generation
   - Increment `embeddedChunks` after each batch
   - Show progress on the document card (e.g., "Embedding 15/45 chunks...") from those two fields

5. Create a vector search function. **It must filter by `userId`** — `documentIds` ultimately comes from the client, and without this a user could pass someone else's document IDs and read their content:
   ```typescript
   import type { DocumentChunkResult } from '@/types';

   export async function searchSimilarChunks(
     queryEmbedding: number[],
     documentIds: string[],
     userId: string,
     limit: number = 5
   ): Promise<DocumentChunkResult[]> {
     const vectorString = `[${queryEmbedding.join(',')}]`;
     return prisma.$queryRaw<DocumentChunkResult[]>`
       SELECT dc.id, dc.content, dc."pageNumber", dc."chunkIndex", dc."documentId",
              d.title AS "documentTitle",
              1 - (dc.embedding <=> ${vectorString}::vector) AS similarity
       FROM "DocumentChunk" dc
       JOIN "Document" d ON dc."documentId" = d.id
       WHERE dc."documentId" = ANY(${documentIds}::text[])
         AND d."userId" = ${userId}
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> ${vectorString}::vector
       LIMIT ${limit}
     `;
   }
   ```
   Filtering by similarity threshold happens in the RAG pipeline (Phase 10), not here — that keeps this function a pure "top K nearest" search.

### Deliverable
All document chunks have vector embeddings stored in pgvector. The `searchSimilarChunks` function can find the most relevant chunks for any query. Document status shows `READY` when complete.

---

## Phase 8: Dashboard Layout & Chat UI

### Goal
Build the app shell (sidebar + main content) and the chat interface.

### Design Direction

The app should feel like a focused productivity tool — clean, minimal, not flashy. Think linear.app or Notion's restraint. Dark mode default with a near-black sidebar and slightly lighter main content area. Use a monochrome palette with a single accent color for interactive elements.

- **Sidebar**: Document list at top, conversation list below, user avatar at bottom. Collapsible on mobile.
- **Chat area**: Messages scroll area taking full height, input pinned at bottom.
- **Message bubbles**: User messages right-aligned with subtle background. AI messages left-aligned with no background. No avatars in bubbles — keep it clean.

### Steps

1. Create `AppShell` component (`src/components/layout/AppShell.tsx`):
   - Sidebar (280px wide) + main content area
   - Sidebar has two sections: "Documents" (list with upload button) and "Chats" (conversation list with new chat button)
   - Mobile: sidebar becomes a sheet/drawer
   - The shell wraps all dashboard pages

2. Create `Sidebar` component:
   - Top: App logo/name "DocuMind"
   - Section 1: "Documents" — list of user's documents with status badges, plus an upload button
   - Section 2: "Conversations" — list of recent conversations, each showing title and last message date
   - Bottom: User avatar, name, sign out button
   - Active states for current document/conversation

3. Create `ChatWindow` component (`src/components/chat/ChatWindow.tsx`):
   - ScrollArea containing messages
   - Auto-scroll to bottom on new messages
   - Loading state (skeleton bubbles while AI is thinking)
   - Empty state: "Select documents and start chatting"

4. Create `MessageBubble` component:
   - Render markdown content (use a simple markdown renderer or just preserve whitespace and basic formatting)
   - For assistant messages: show the streaming text as it arrives
   - For messages with source citations: show a "Sources" section with expandable source cards
   - For messages with tool calls: show a `ToolCallDisplay` component (built later)
   - Timestamp on hover

5. Create `ChatInput` component:
   - Textarea that grows with content (up to ~4 lines, then scroll)
   - Send button (enabled only when there's text)
   - Submit on Enter (Shift+Enter for new line)
   - Show a document selector above the input (which documents to chat with)
   - Disabled state while AI is responding

6. Create the chat page `src/app/(dashboard)/chat/[id]/page.tsx`:
   - Fetch conversation and messages
   - Render ChatWindow with messages
   - Render ChatInput
   - Handle message sending (wire up in Phase 9)

7. Create the new chat page `src/app/(dashboard)/chat/page.tsx`:
   - Let user select which documents to include
   - Show document cards with checkboxes
   - "Start Chat" button creates a new conversation and redirects to `/chat/[id]`

8. Create the conversation CRUD API routes:
   - `POST /api/chat/conversations` — create a new conversation (body: `{ documentIds: string[] }`). Validate the body with zod, then verify **every** `documentId` belongs to the current user (`prisma.document.count({ where: { id: { in: ids }, userId } })` must equal `ids.length`) — reject with 403 otherwise. Same check applies when adding documents mid-conversation (Phase 12).
   - `GET /api/chat/conversations` — list user's conversations
   - `GET /api/chat/conversations/[id]` — get conversation with messages
   - `DELETE /api/chat/conversations/[id]` — delete a conversation

### Deliverable
A polished app shell with sidebar navigation, document list, conversation list, and a chat interface with message bubbles and input. No AI yet — just the UI.

---

## Phase 9: AI Chat with Streaming

### Goal
Integrate Claude's Messages API for basic chat with real-time streaming responses.

### Key Concept — Streaming
Without streaming, the user sends a message and waits 5-15 seconds staring at a blank screen before the full response appears. With streaming, tokens appear one by one in real-time as Claude generates them — just like ChatGPT and claude.ai. This is critical for UX.

We use the Anthropic SDK's native streaming support and pipe the text deltas into a standard web `ReadableStream` returned from the Route Handler. (The Vercel AI SDK's old `StreamingTextResponse` helper no longer exists, and doing it by hand teaches you what those helpers hide.)

### Steps

1. Create the Anthropic client (`src/lib/ai/anthropic.ts`):
   ```typescript
   import Anthropic from '@anthropic-ai/sdk';

   export const anthropic = new Anthropic({
     apiKey: process.env.ANTHROPIC_API_KEY,
   });
   ```

2. Create prompt templates (`src/lib/ai/prompts.ts`):
   ```typescript
   export const SYSTEM_PROMPT = `You are DocuMind, an intelligent document assistant. You help users understand, analyze, and extract information from their uploaded documents.

   Guidelines:
   - Answer questions based on the provided document context
   - If the context doesn't contain enough information to answer, say so honestly
   - Cite specific parts of the documents when referencing them
   - Be concise but thorough
   - Use markdown formatting for readability (headers, bold, lists, code blocks)
   - If asked about something outside the documents, clarify that you can only help with the uploaded content
   `;

   export function buildRAGPrompt(context: string, question: string): string {
     return `Here is relevant context from the user's documents:

   <context>
   ${context}
   </context>

   Based on this context, please answer the following question:
   ${question}`;
   }
   ```

3. Create the chat API route (`src/app/api/chat/route.ts`):
   ```typescript
   // POST /api/chat
   // Body: { conversationId: string, message: string }
   // Returns: Streaming response

   // Steps:
   // 1. Validate the request, verify user owns the conversation
   // 2. Save the user message to the database
   // 3. Fetch conversation history (last N messages for context)
   // 4. Call Claude API with streaming enabled
   // 5. Stream the response back to the client
   // 6. After stream completes, save the assistant message to the database
   ```

   Implementation approach:
   ```typescript
   const stream = anthropic.messages.stream({
     model: CHAT_MODEL, // from src/lib/ai/anthropic.ts — see "Models" in Important Notes
     max_tokens: 16000,
     system: SYSTEM_PROMPT,
     messages: conversationHistory, // Anthropic.MessageParam[]
   });

   const encoder = new TextEncoder();
   const body = new ReadableStream<Uint8Array>({
     async start(controller) {
       stream.on('text', (delta) => controller.enqueue(encoder.encode(delta)));
       try {
         const final = await stream.finalMessage(); // full message + usage
         // save assistant message (content, model, usage) to the DB here
         controller.close();
       } catch (err) {
         controller.error(err);
       }
     },
     cancel() {
       stream.abort(); // client navigated away — stop paying for tokens
     },
   });

   return new Response(body, {
     headers: { 'Content-Type': 'text/plain; charset=utf-8' },
   });
   ```

4. Handle the streaming on the client side. Create a custom `useChat` hook (`src/hooks/useChat.ts`):
   ```typescript
   // The hook should:
   // - Manage messages state
   // - Send user messages via fetch to /api/chat
   // - Read the streaming response using ReadableStream / EventSource
   // - Append tokens to the assistant message as they arrive
   // - Handle loading/error states
   // - Return: { messages, sendMessage, isLoading, error }
   ```

5. Wire up the chat page to use the `useChat` hook:
   - On send: add user message to UI immediately (optimistic)
   - Start streaming: show an empty assistant bubble that fills with text
   - On stream complete: finalize the message

6. Handle conversation history for multi-turn:
   - Fetch the last 20 messages from the database
   - Format them as `[{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]`
   - Send as the `messages` array to Claude
   - This gives Claude context of the full conversation

### Deliverable
Users can chat with Claude in real-time with streaming responses. Messages are persisted to the database. The conversation maintains context across messages (multi-turn). This is basic chat without RAG — that comes next.

---

## Phase 10: RAG Pipeline — Vector Search & Augmented Generation

### Goal
Build the full RAG pipeline: when a user asks a question, embed the query, search for relevant document chunks, inject them as context, and generate an informed answer.

### Key Concept — The RAG Pipeline
RAG has 4 steps:
1. **Query Embedding**: Convert the user's question into a vector
2. **Retrieval**: Find the most similar document chunks via vector search
3. **Augmentation**: Inject the retrieved chunks into the prompt as context
4. **Generation**: Send the augmented prompt to Claude for an answer

This is the most important pattern in modern AI applications. It lets Claude answer questions about documents it has never seen during training.

### Steps

1. Create the RAG pipeline (`src/lib/ai/rag.ts`):
   ```typescript
   // Starting point for text-embedding-3-small. Its cosine similarities run lower than
   // you'd expect — clearly relevant chunks often score 0.3–0.6, rarely above 0.7.
   // Tune these by logging scores for real questions against your own documents.
   export const MIN_SIMILARITY = 0.3;
   export const LOW_CONFIDENCE_SIMILARITY = 0.45;

   export async function ragPipeline(
     query: string,
     documentIds: string[],
     userId: string,
     options?: { topK?: number; minSimilarity?: number }
   ): Promise<{ context: string; sourceChunks: DocumentChunkResult[] }> {
     const topK = options?.topK ?? 5;
     const minSimilarity = options?.minSimilarity ?? MIN_SIMILARITY;

     // Step 1: Embed the query
     const queryEmbedding = await generateEmbedding(query);

     // Step 2: Search for similar chunks (scoped to this user), drop weak matches
     const similarChunks = (
       await searchSimilarChunks(queryEmbedding, documentIds, userId, topK)
     ).filter((chunk) => chunk.similarity >= minSimilarity);

     // Step 3: Build context string
     const context = similarChunks
       .map((chunk, i) => `[Source ${i + 1} — ${chunk.documentTitle}, Page ${chunk.pageNumber ?? '?'}]\n${chunk.content}`)
       .join('\n\n---\n\n');

     return { context, sourceChunks: similarChunks };
   }
   ```

2. Update the chat API route (`src/app/api/chat/route.ts`) to use RAG:
   ```typescript
   // Before calling Claude:
   // 1. Get the conversation's documentIds
   // 2. Run the RAG pipeline with the user's message
   // 3. Build the augmented prompt using buildRAGPrompt()
   // 4. Include the context in the user message sent to Claude
   // 5. Save sourceChunkIds on the assistant message for citation display
   ```

3. Update the system prompt to instruct Claude about using document context:
   ```typescript
   export const RAG_SYSTEM_PROMPT = `You are DocuMind, an intelligent document assistant.

   You will be given context from the user's uploaded documents enclosed in <context> tags.
   Each source is labeled with a source number, document title, and page number.

   Guidelines:
   - Answer questions based PRIMARILY on the provided document context
   - When you reference information from the context, cite the source like [Source 1] or [Source 2, 3]
   - If the context doesn't contain enough information, say so honestly and explain what information is missing
   - Never make up information that isn't in the context
   - Be concise but thorough
   - Use markdown formatting for readability`;
   ```

4. Create a `SourceCard` component (`src/components/chat/SourceCard.tsx`):
   - Shows which document chunks were used to answer the question
   - Displays: document title, page number, a snippet of the chunk content, similarity score
   - Collapsible — show a preview, expand for full chunk text
   - Appears below the assistant message

5. Update `MessageBubble` to display source cards when `sourceChunkIds` is present:
   - After the assistant's text, show a "Sources used" section
   - Render SourceCard for each source chunk
   - Make this section collapsible (collapsed by default, showing count)

6. Add a relevance indicator:
   - If no chunks meet `MIN_SIMILARITY` (~0.3), tell the user the documents might not contain relevant information
   - If the best chunk is below `LOW_CONFIDENCE_SIMILARITY` (~0.45), add a caveat that the information might not be directly relevant
   - These numbers are model-specific starting points — log real scores and adjust

### Deliverable
When users ask questions, the app finds relevant document chunks via vector search, injects them as context, and Claude answers with citations. Source cards show exactly which parts of which documents were used. This is the core RAG experience.

---

## Phase 11: Tool Calling / Function Calling

### Goal
Define tools that Claude can call during a conversation — search documents, get document metadata, and perform structured operations.

### Key Concept — Tool Calling
Tool calling (also called function calling) lets the LLM decide to invoke a function instead of (or in addition to) generating text. For example, if a user asks "How many pages is the financial report?", Claude can call a `get_document_info` tool to look up the actual page count instead of guessing.

The flow is:
1. You define tools with names, descriptions, and parameter schemas
2. You send the tools along with the messages to Claude
3. Claude decides whether to call a tool or just respond with text
4. If it calls a tool, you execute the function server-side and send the result back
5. Claude uses the tool result to formulate its final response

This often requires a **multi-step loop**: send message → get tool call → execute tool → send result back → get final response.

### Steps

1. Define the tools (`src/lib/ai/tools.ts`):
   ```typescript
   export const TOOLS = [
     {
       name: 'search_documents',
       description: 'Search through the user\'s uploaded documents for specific information. Use this when the user asks about something specific and you need to find relevant passages. Returns the most relevant text chunks.',
       input_schema: {
         type: 'object' as const,
         properties: {
           query: {
             type: 'string',
             description: 'The search query — what to look for in the documents',
           },
           max_results: {
             type: 'number',
             description: 'Maximum number of results to return (default: 5)',
           },
         },
         required: ['query'],
       },
     },
     {
       name: 'get_document_info',
       description: 'Get metadata about a specific uploaded document, including title, page count, file size, and upload date. Use when the user asks about document properties.',
       input_schema: {
         type: 'object' as const,
         properties: {
           document_title: {
             type: 'string',
             description: 'The title or name of the document to look up',
           },
         },
         required: ['document_title'],
       },
     },
     {
       name: 'list_documents',
       description: 'List all documents the user has uploaded and attached to this conversation. Use when the user asks what documents are available or wants an overview.',
       input_schema: {
         type: 'object' as const,
         properties: {},
         required: [],
       },
     },
     {
       name: 'get_page_content',
       description: 'Get the full text content of a specific page from a document. Use when the user asks about a specific page.',
       input_schema: {
         type: 'object' as const,
         properties: {
           document_title: {
             type: 'string',
             description: 'The document to read from',
           },
           page_number: {
             type: 'number',
             description: 'The page number to retrieve',
           },
         },
         required: ['document_title', 'page_number'],
       },
     },
   ];
   ```

2. Implement the tool execution functions (`src/lib/ai/tools.ts`):
   ```typescript
   // toolInput is `unknown` on purpose: validate it with a zod schema per tool
   // before using it — the model's arguments are untrusted input like any request body.
   export async function executeTool(
     toolName: string,
     toolInput: unknown,
     documentIds: string[],
     userId: string
   ): Promise<string> {
     switch (toolName) {
       case 'search_documents':
         // Use the RAG pipeline's search
         // Return formatted results
       case 'get_document_info':
         // Query the Document table
         // Return formatted metadata
       case 'list_documents':
         // Query all documents for this conversation
         // Return formatted list
       case 'get_page_content':
         // Find chunks for that page number
         // Return the combined text
       default:
         return 'Unknown tool';
     }
   }
   ```

3. Update the chat API route to support tool calling with a **tool use loop**:
   ```typescript
   // The tool calling loop:
   const MAX_TOOL_ITERATIONS = 5; // guard against a runaway loop

   let response = await anthropic.messages.create({
     model: CHAT_MODEL,
     max_tokens: 16000,
     system: RAG_SYSTEM_PROMPT,
     tools: TOOLS,
     messages: conversationHistory,
   });

   let iterations = 0;
   while (response.stop_reason === 'tool_use' && iterations++ < MAX_TOOL_ITERATIONS) {
     // Claude can call SEVERAL tools in one turn (parallel tool use). Every
     // tool_use block needs a matching tool_result, or the next request is a 400.
     const toolUseBlocks = response.content.filter(
       (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
     );

     const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
       toolUseBlocks.map(async (block) => {
         try {
           const content = await executeTool(block.name, block.input, documentIds, userId);
           return { type: 'tool_result', tool_use_id: block.id, content };
         } catch (err) {
           // Report failures to Claude instead of dropping the result
           const message = err instanceof Error ? err.message : 'Tool failed';
           return { type: 'tool_result', tool_use_id: block.id, content: message, is_error: true };
         }
       })
     );

     // Append the full assistant content, then ALL results in ONE user message
     conversationHistory.push(
       { role: 'assistant', content: response.content },
       { role: 'user', content: toolResults }
     );

     response = await anthropic.messages.create({
       model: CHAT_MODEL,
       max_tokens: 16000,
       system: RAG_SYSTEM_PROMPT,
       tools: TOOLS,
       messages: conversationHistory,
     });
   }

   // Now stream the final text response
   ```

   **Note**: The tool calling loop uses non-streaming requests. Once tool calling is resolved, you can stream the final response. Alternatively, you can stream the entire thing with `anthropic.messages.stream()` and handle `tool_use` events in the stream.

4. Create a `ToolCallDisplay` component (`src/components/chat/ToolCallDisplay.tsx`):
   - Show when Claude calls a tool: display the tool name and a summary of what it did
   - Visual indicator: a small card or inline badge showing "🔍 Searched documents for 'revenue forecast'"
   - Collapsible to show the full tool input and result
   - Style it distinctly from regular message text (use a different background, maybe a dashed border)

5. Update `MessageBubble` to render tool calls inline:
   - When a message has `toolCalls` data, render `ToolCallDisplay` components
   - Show them in order: tool call → tool result → then the final text

6. Store tool calls and results in the Message record:
   - Save `toolCalls` (what Claude requested) and `toolResults` (what the tools returned) as JSON

### Deliverable
Claude can now call tools during conversations. When a user asks "What documents do I have?" or "Search for the section about pricing", Claude intelligently decides to use a tool, executes it, and incorporates the result into its answer. Tool calls are displayed in the UI.

---

## Phase 12: Multi-turn Conversation Management

### Goal
Properly manage conversation context across many messages, handle token limits, and implement conversation features.

### Key Concept — Context Window Management
Claude has a context window limit (200K tokens for Sonnet). As conversations get long, you need to manage what history gets sent. Strategies:
- **Sliding window**: Send only the last N messages
- **Summarization**: Summarize older messages and include the summary
- **Smart truncation**: Always include the system prompt and the most recent messages, truncate the middle

### Steps

1. Implement a context window manager (`src/lib/ai/context.ts`):
   ```typescript
   const MAX_CONTEXT_TOKENS = 50000; // Stay well under the limit, leaving room for response

   export function buildMessageHistory(
     messages: Message[],
     systemPromptTokens: number = 500
   ): { role: string; content: string }[] {
     // Start from the most recent messages and work backwards
     // Approximate token count for each message (content.length / 4)
     // Stop adding messages when we hit MAX_CONTEXT_TOKENS
     // Always include the most recent user message
   }
   ```

2. Add conversation title generation:
   - After the first user message + AI response, call Claude with a small prompt: "Generate a short title (max 6 words) for this conversation based on: [first user message]"
   - Update the conversation title in the database
   - Show the generated title in the sidebar

3. Implement conversation management features:
   - **Rename**: Click to edit conversation title
   - **Delete**: Delete a conversation (with confirmation dialog)
   - **New chat**: Start a fresh conversation, selecting which documents to include
   - **Add/remove documents**: Let users modify which documents a conversation has access to mid-conversation

4. Add a token usage display:
   - Track tokens used per message (from Claude's API response: `response.usage.input_tokens`, `response.usage.output_tokens`)
   - Store on the Message record
   - Show total tokens used in the conversation (optional: in the sidebar or a settings panel)

5. Handle edge cases:
   - Very long user messages: truncate or warn
   - Empty responses from Claude: show a helpful error
   - Rate limit errors (HTTP 429): implement exponential backoff with a user-facing "Please wait" message

### Deliverable
Conversations properly manage context window limits, auto-generate titles, and handle long conversations gracefully. Users can manage their conversations (rename, delete, switch between them).

---

## Phase 13: Source Citations & Document Viewer

### Goal
Enhance the citation experience — when Claude references a source, users can click to see the exact chunk and optionally view the source in context.

### Steps

1. Enhance the `SourceCard` component:
   - Show a highlighted preview of the chunk text (first 100 characters)
   - Show document title, page number, and similarity score (as a percentage: "92% relevant")
   - Click to expand and see the full chunk text
   - "Open document" link that navigates to the document page

2. Create a document detail page (`src/app/(dashboard)/documents/[id]/page.tsx`):
   - Show document metadata: title, file size, page count, upload date, status, chunk count
   - Show a list of all chunks with their content (paginated or virtualized)
   - Search within the document's chunks (client-side filter or a dedicated search)
   - "Chat with this document" button — creates a new conversation with this document pre-selected
   - Delete document button (with confirmation — cascades to delete chunks and removes from conversations)

3. Add citation highlighting in messages:
   - When Claude's response includes `[Source 1]` or `[Source 2, 3]` references, parse and style them
   - Turn them into clickable links/buttons that scroll to or highlight the corresponding source card below the message
   - Use a subtle highlight color for the citation markers

4. Create an API to delete documents:
   - `DELETE /api/documents/[id]`
   - Verify ownership
   - Delete the file from disk
   - Cascade delete chunks (handled by Prisma `onDelete: Cascade`)
   - Remove the document ID from any conversations' `documentIds` array

### Deliverable
A polished citation experience where users can trace every claim back to its source in the document. Document detail pages show all chunks and metadata.

---

## Phase 14: Image Understanding (Claude Vision)

### Goal
Add the ability to upload images (screenshots, diagrams, photos of handwritten notes) and have Claude analyze them.

### Key Concept — Vision
Claude can analyze images sent alongside text. This opens up use cases like:
- "What does this diagram show?"
- "Transcribe this handwritten note"
- "Compare this chart to the data in my document"

This is a simpler integration than RAG but an important skill — sending multimodal content to an LLM.

### Steps

1. Update the `ChatInput` component to support image attachments:
   - Add a paperclip/image icon button next to the send button
   - Accept images (PNG, JPG, GIF, WebP) — validate type and size (max 5MB)
   - Show a thumbnail preview of the attached image before sending
   - Allow removing the attachment

2. Update the chat API route to handle image messages:
   ```typescript
   // When the user sends an image:
   // 1. Read the image as base64
   // 2. Send to Claude as a multi-part message:
   messages: [{
     role: 'user',
     content: [
       {
         type: 'image',
         source: {
           type: 'base64',
           media_type: 'image/png', // or jpeg, gif, webp
           data: base64ImageData,
         },
       },
       {
         type: 'text',
         text: userMessage || 'Please analyze this image.',
       },
     ],
   }]
   ```

3. Store image references:
   - Save uploaded images to `./uploads/{userId}/images/{messageId}.{ext}`
   - Store the file path in the message's `attachments` JSON field (added in Phase 2), e.g. `[{ type: "image", path, mediaType }]`
   - Serve images through an authenticated route (e.g. `GET /api/attachments/[messageId]`) that checks ownership — never expose the `uploads/` folder publicly
   - When rebuilding history for later turns, re-read the image from disk and re-attach it (the API is stateless), or replace it with a text placeholder like `[image: chart.png]` to save tokens
   - Display the image inline in the chat message bubble

4. Update `MessageBubble` to render inline images:
   - If a user message contains an image, display it in the bubble (responsive, max-width)
   - Clicking the image opens it in a lightbox or full-screen view

5. Combine vision with RAG:
   - If a user sends an image AND is chatting with documents, Claude can cross-reference both
   - Example: User uploads a chart screenshot and asks "How does this compare to the data in section 3?"
   - Send both the image and the RAG context to Claude

### Deliverable
Users can upload images in chat and get Claude's analysis. Images display inline in the conversation. This demonstrates multimodal AI integration.

---

## Phase 15: Polish, Error Handling & GitHub-Ready

### Goal
Production-quality error handling, loading states, responsive design, and prepare for GitHub showcase.

### Steps

1. **Error Handling**:
   - API route error boundaries: catch and return proper error responses with status codes
   - Client-side error states: show toast notifications for transient errors, inline error messages for form validation
   - AI-specific errors:
     - Rate limit (429): show "AI is busy, please wait a moment" with countdown
     - Overloaded (529): "AI service is at capacity, please try again shortly"
     - Auth errors (401): "API key issue" — don't expose the key
     - Context too long (400): "Conversation is too long, try starting a new chat"
   - Document processing errors: show specific error messages (e.g., "Could not extract text from this PDF — it might be image-only")

2. **Loading States**:
   - Document upload: progress bar
   - Document processing: status animation (spinner with status text)
   - Chat: typing indicator (animated dots) while waiting for the stream to start
   - Message streaming: cursor/blinking indicator at the end of the streaming text
   - Page loads: skeleton screens for document list and conversation list

3. **Responsive Design**:
   - Mobile (< 768px): sidebar becomes a slide-out sheet, full-width chat
   - Tablet (768-1024px): narrow sidebar (icons only), wider chat
   - Desktop (> 1024px): full sidebar + chat

4. **Empty States**:
   - No documents: illustration + "Upload your first document to get started"
   - No conversations: "Start a new chat to begin asking questions"
   - No messages in a conversation: "Ask a question about your documents"

5. **Rate Limiting**:
   - Add basic rate limiting on API routes (e.g., max 20 messages per minute per user)
   - Use an in-memory store or database counter
   - Return 429 with a helpful message when exceeded

6. **README.md** for GitHub:
   ```markdown
   # DocuMind AI

   An AI-powered document chat assistant built with Next.js, Claude, and RAG.

   Upload PDFs, ask questions, and get intelligent answers with source citations.

   ## Features
   - 📄 PDF upload and processing
   - 🧠 RAG pipeline (embeddings + vector search)
   - 💬 Real-time streaming chat with Claude
   - 🔧 AI tool calling / function calling
   - 📎 Source citations with document references
   - 🖼️ Image understanding (Claude Vision)
   - 🔐 Authentication with NextAuth

   ## Tech Stack
   [list the stack]

   ## AI Concepts Demonstrated
   - LLM API integration (Anthropic Claude)
   - Streaming responses
   - Embeddings generation (OpenAI text-embedding-3-small)
   - Vector similarity search (pgvector)
   - Retrieval-Augmented Generation (RAG)
   - Tool/function calling
   - Multi-turn conversation management
   - Context window management
   - Multimodal input (Vision)
   - Prompt engineering

   ## Getting Started
   [setup instructions]

   ## Architecture
   [include a diagram of the RAG pipeline]

   ## Screenshots
   [add screenshots]
   ```

7. **Environment & Config**:
   - `.env.example` with all required variables (no real keys)
   - Docker Compose file for PostgreSQL with pgvector (created in Phase 1 — `version:` is obsolete in Compose v2 and omitted):
     ```yaml
     services:
       db:
         image: pgvector/pgvector:pg16
         environment:
           POSTGRES_USER: documind
           POSTGRES_PASSWORD: documind
           POSTGRES_DB: documind
         ports:
           - "5432:5432"
         volumes:
           - pgdata:/var/lib/postgresql/data
     volumes:
       pgdata:
     ```

8. **Code Cleanup**:
   - Remove any `console.log` statements used during development
   - Add TypeScript types everywhere (no `any` types)
   - Extract magic numbers into constants
   - Add JSDoc comments on key functions (especially the AI/RAG functions)
   - Ensure consistent code formatting

9. **Optional Enhancements** (if you want to go further):
   - Dark/light mode toggle
   - Export conversation as markdown
   - Document processing queue (for handling multiple uploads)
   - Search across all documents (not just in a conversation)
   - Keyboard shortcuts (Cmd+K for new chat, Cmd+N for upload)

### Deliverable
A polished, production-quality application ready to push to GitHub. Clean README, proper error handling, responsive design, and all AI integrations working smoothly.

---

## Build Order Summary

| Phase | What You Build | AI Concept Learned |
|-------|---------------|-------------------|
| 1 | Project setup & deps | — |
| 2 | Database schema + pgvector | Vector databases |
| 3 | Authentication | — |
| 4 | Document upload UI & storage | — |
| 5 | PDF text extraction | Document processing for AI |
| 6 | Text chunking | Chunking strategies for RAG |
| 7 | Embedding generation & storage | Embeddings, vector storage |
| 8 | App shell & chat UI | — |
| 9 | Claude chat with streaming | LLM API, streaming, prompt engineering |
| 10 | RAG pipeline | Full RAG: embed → search → augment → generate |
| 11 | Tool / function calling | Tool use, multi-step reasoning |
| 12 | Multi-turn conversation mgmt | Context windows, token management |
| 13 | Source citations & doc viewer | Citation UX |
| 14 | Image understanding | Multimodal AI (vision) |
| 15 | Polish & GitHub-ready | Error handling, production patterns |

## Important Notes

- **API Keys**: You need BOTH an Anthropic API key (for Claude chat) and an OpenAI API key (for embeddings only). Claude Pro subscription does NOT include API access — sign up separately at console.anthropic.com and platform.openai.com.
- **pgvector**: Use the `pgvector/pgvector:pg16` Docker image or install the extension on your existing PostgreSQL. Cloud providers like Supabase and Neon have pgvector built in.
- **Credits timeline**: No API credits are needed until Phase 7. Phases 1–6 and Phase 8 (UI) run entirely on local services (Docker Postgres, GitHub OAuth, filesystem). Phase 7 needs the OpenAI key (embeddings); Phase 9 onward needs the Anthropic key. If you're waiting on credits, you can build Phase 8 before Phase 7.
- **Cost**: For learning/development, expect a few dollars total. Both consoles require a $5 minimum credit purchase. Embeddings are near-free (~$0.02/million tokens).
- **Models**: Define the model ID once as `CHAT_MODEL` in `src/lib/ai/anthropic.ts` so it's a one-line change. Current options (per million tokens, input/output):
  - `claude-opus-5` — $5 / $25 — most capable
  - `claude-sonnet-5` — $2 / $10 — strong and cheaper
  - `claude-haiku-4-5` — $1 / $5 — fastest/cheapest; good for development and for small jobs like title generation
  Use exact IDs as written (no date suffixes). Model IDs change over time — check the Anthropic models docs before starting Phase 9.
- **Alternative embeddings**: Voyage AI (Anthropic's recommended embeddings partner) has a generous free tier. If you switch, change `vector(1536)` to that model's dimension **before** Phase 2's migration.
