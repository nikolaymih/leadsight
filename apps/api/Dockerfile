# Build from the repository root:  docker build -f apps/api/Dockerfile -t leadsight-api .
# Runs the Fastify API (`node dist/server.js`) or, with a different command, the migration
# step (`node dist/migrate.js`). One image serves both so the compose file needs one build.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# Dependencies: only manifests, so this layer is cached until a package.json or the lockfile changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @leadsight/api...

# Build core → contract → api, then flatten the api and its workspace deps into /out.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/contract packages/contract
COPY apps/api apps/api
RUN pnpm --filter @leadsight/core build \
 && pnpm --filter @leadsight/contract build \
 && pnpm --filter @leadsight/api build \
 && pnpm --filter @leadsight/api deploy --legacy --prod /out

FROM node:22-alpine AS runner
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "dist/server.js"]
