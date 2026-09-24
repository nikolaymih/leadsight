# Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://leads.example.com -t leadsight-web .
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time, so the image is bound
# to one public origin. With the compose setup the API is reverse-proxied under the same
# origin as the web app, so this is simply the site's URL.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/contract/package.json packages/contract/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @leadsight/web...

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/contract packages/contract
COPY apps/web apps/web
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build-arg is required" && exit 1) \
 && pnpm --filter @leadsight/core build \
 && pnpm --filter @leadsight/contract build \
 && pnpm --filter @leadsight/web build

# Next's standalone output carries its own pruned node_modules; nothing else from the repo is needed.
FROM node:22-alpine AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
