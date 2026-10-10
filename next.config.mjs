import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  devIndicators: false,
};
export default nextConfig;
