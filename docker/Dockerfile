# drelm server
# Multi-stage build: install + compile in build stage, run in slim stage.
# No client code — the client is static files served separately.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace root (tsconfig.base.json is extended by all packages)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/server/package.json packages/server/

# Install dependencies (no client — server only)
RUN pnpm install --frozen-lockfile --filter @drelm/server --filter @drelm/types

# Copy source and build
COPY packages/types/ packages/types/
COPY packages/server/ packages/server/
RUN pnpm --filter @drelm/types build && pnpm --filter @drelm/server build

# --- Production stage ---
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/types/package.json packages/types/
COPY --from=build /app/packages/types/dist/ packages/types/dist/
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist/ packages/server/dist/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/server/node_modules/ packages/server/node_modules/
COPY --from=build /app/packages/types/node_modules/ packages/types/node_modules/

ENV PORT=3000
EXPOSE 3000

# Run as non-root — limits blast radius if Node.js is compromised.
USER node

# No persistent storage. No volumes. No filesystem writes.
# The server holds state in memory only.
CMD ["node", "packages/server/dist/index.js"]
