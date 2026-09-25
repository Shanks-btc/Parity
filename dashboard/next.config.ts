import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root has its own package-lock.json (the backend in ../src), which made Next infer the
  // repo root as the workspace. The dashboard is self-contained in this phase, so pin it here.
  // If a later phase imports backend code from ../src, widen this to path.join(__dirname, "..").
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
