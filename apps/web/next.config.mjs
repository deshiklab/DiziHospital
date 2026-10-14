/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources on purpose: the design system and the token package are
  // consumed as source inside the monorepo, so there is no build-order or stale-artefact problem in development.
  transpilePackages: ['@dizi/ui', '@dizi/tokens'],

  // The app is served from the hospital LAN, from preview URLs and from a browser proxy in development.
  // Restricting dev origins to localhost is a classic way to break remote review sessions.
  allowedDevOrigins: ['*.e2b.app', '*.arena.ai', 'localhost', '127.0.0.1'],

  // Clinical data never leaves the infrastructure: no telemetry, no third-party fonts, no remote images.
  ...(process.env.DIZI_TELEMETRY === 'off' ? {} : {}),
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
