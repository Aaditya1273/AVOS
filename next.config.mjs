/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is for the Docker image only. It is opt-in because
  // `next start` refuses to serve a standalone build, so leaving it always-on
  // breaks `npm start` locally for the sake of a target that sets its own flag.
  // Vercel ignores this either way and uses its own packaging.
  output: process.env.AVOS_STANDALONE === '1' ? 'standalone' : undefined,
  experimental: {
    // The CSV ledger and the eval output are read from disk at request time via
    // paths built from `process.cwd()`. Vercel's file tracer cannot follow a
    // constructed path, so they are included explicitly — without this, every
    // serverless invocation 404s on its own evidence.
    //
    // (In Next 14 this key lives under `experimental`; it graduates to the top
    // level in 15. Putting it at the top level here silently does nothing, which
    // is a fun way to ship a build that works locally and 500s in production.)
    outputFileTracingIncludes: {
      '/**': ['./data/**', './evals/raw/**'],
    },
  },
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ['app', 'components', 'lib', 'evals'],
  },
}

export default nextConfig
