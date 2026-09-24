import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The contract package is consumed from its built dist; nothing else needs transpiling.
  transpilePackages: [],
  typescript: { ignoreBuildErrors: false },
  // Self-contained server for the Docker image (apps/web/Dockerfile). The tracing root is the
  // monorepo root so workspace packages are copied into .next/standalone as well.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default nextConfig;
