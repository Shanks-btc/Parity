import path from "node:path";
import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";

// The API routes import the verified backend from ../src, so the workspace root is the repo root and the
// backend's own .env (SOLANA_RPC_URL — the server-side Helius key, never sent to the browser) is loaded for
// local runs. In a deployed environment the same variables come from the platform instead.
loadEnv({ path: path.join(__dirname, "..", ".env"), quiet: true });

const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname, "..") },
  // Loaded from the repo-root node_modules at runtime rather than bundled.
  serverExternalPackages: ["@anthropic-ai/sdk", "@kamino-finance/klend-sdk", "@kamino-finance/farms-sdk", "@solana/kit", "@solana/signers", "@solana-program/address-lookup-table", "decimal.js"],
};

export default nextConfig;
