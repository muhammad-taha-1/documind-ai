import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests talk to the real Postgres from docker-compose.yml.
// Start it first: `npm run db:up`
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["dotenv/config"],
    // Tests mock the embeddings API. If one forgets to, this fake key makes the
    // real API reject the call instead of quietly spending credits. (dotenv
    // never overwrites variables that are already set.)
    env: { OPENAI_API_KEY: "sk-test-not-a-real-key" },
    // Tests share one database, so run files one at a time
    fileParallelism: false,
  },
});
