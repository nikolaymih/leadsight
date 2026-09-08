import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The contract package is consumed from its built dist; nothing else needs transpiling.
  transpilePackages: [],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
