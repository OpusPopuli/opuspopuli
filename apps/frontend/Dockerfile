FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY apps/frontend/package.json ./

RUN corepack enable

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --lockfile=false --ignore-workspace

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY apps/frontend/ .
# Overlay node_modules from deps AFTER copying frontend source
# (COPY apps/frontend/ . replaces the node_modules directory otherwise)
COPY --from=deps /app/node_modules ./node_modules

# Resolve asset symlinks: replace dangling symlinks with actual directories
# (public/logos, public/icons, public/favicons symlink to ../../../assets/ which is outside Docker context)
RUN rm -f public/logos public/icons public/favicons public/social
COPY assets/logos/ ./public/logos/
COPY assets/icons/ ./public/icons/
COPY assets/favicons/ ./public/favicons/
COPY assets/social/ ./public/social/

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1
# Enable standalone output for Docker (Cloudflare Pages builds without this)
ENV NEXT_OUTPUT=standalone

RUN corepack enable
RUN pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
