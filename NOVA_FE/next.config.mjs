import { fileURLToPath } from "node:url";
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully client-side SPA → static export, served by Firebase Hosting.
  output: "export",
  images: { unoptimized: true },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  webpack(config) {
    // Next 15's bundled webpack fails in matchModuleReference when concatenating
    // the current Supabase ESM client. Keep tree shaking, skip concatenation.
    config.optimization.concatenateModules = false;
    return config;
  },
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.ngrok-free.dev",
  ],
};
export default nextConfig;
