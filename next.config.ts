import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse runs pdf.js, which loads its worker from a separate file at
  // runtime. Bundling copies the main code into .next/ but not the worker
  // ("Setting up fake worker failed: Cannot find module ...pdf.worker.mjs"),
  // so load it with Node's require from node_modules instead.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
