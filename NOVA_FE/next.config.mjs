/** @type {import('next').NextConfig} */
const nextConfig = {
  // All backend logic lives in a separate Spring Boot service on :8080.
  // Relative /api/* calls from the browser are proxied there in development.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8080/api/:path*",
      },
    ];
  },
  // Allow the dev server to be reached through ngrok tunnels.
  // Add your concrete ngrok host here if the wildcard is not matched.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.ngrok-free.dev",
  ],
};

export default nextConfig;
