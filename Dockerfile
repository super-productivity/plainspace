# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS builder
WORKDIR /app

# Cache npm install on manifests.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/

RUN npm ci --ignore-scripts

# Sources.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# Build the SolidJS SPA into packages/web/dist.
RUN npm run build --workspace @plainspace/web

# ---

FROM node:22-alpine AS prod-deps
WORKDIR /app

# Install only the server workspace's runtime graph. tsx is intentionally a
# runtime dependency while the server executes TypeScript source; frontend
# build tools, tests, linters, and Drizzle Kit stay out of the final image.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts --workspace @plainspace/server && \
    npm cache clean --force

# ---

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=1

# Copy the runtime dependency graph and only the source/artifacts needed to
# migrate and serve. The TypeScript runtime remains the KISS choice until the
# shared workspace is published from dist rather than source.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/src packages/shared/src
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/src packages/server/src
COPY --from=builder /app/packages/server/drizzle packages/server/drizzle
COPY --from=builder /app/packages/web/dist packages/web/dist

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
