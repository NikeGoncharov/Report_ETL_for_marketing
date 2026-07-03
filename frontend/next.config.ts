import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  // standalone-рантайм для компактного production Docker-образа (см. frontend/Dockerfile).
  output: "standalone",
};

export default nextConfig;
