/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained server bundle for the Docker image. Vercel ignores
  // this and uses its own packaging, so both targets work from one config.
  output: 'standalone',
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
