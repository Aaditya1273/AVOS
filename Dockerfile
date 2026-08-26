# AVOS Verify — reproducible build.
#
# Three stages, so the runtime image carries a server and its evidence and
# nothing else: no toolchain, no dev dependencies, no source.
#
# The CSV ledger and the eval output are copied explicitly rather than left to
# Next's file tracer. Tracing cannot follow a path built from `process.cwd()` at
# runtime, and a container that boots cleanly and then 500s on its own data is a
# worse outcome than a slightly larger image.

# --- deps --------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# --- build -------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No OPENAI_API_KEY at build time, so the offline mock is what gets exercised —
# which is the intended default for a reviewer running this cold.
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# The evidence. Read at request time from `process.cwd()`.
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/evals/raw ./evals/raw

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/decision?case_id=B092').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
