# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# Bring in workspace metadata so pnpm can build the dependency graph.
FROM base AS deps
COPY pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/module-sdk-ts/package.json packages/module-sdk-ts/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile=false --filter "@flows-funds/web..."

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV OUTPUT_FILE_TRACING_ROOT=/repo
COPY --from=deps /repo/node_modules /repo/node_modules
COPY --from=deps /repo/apps/web/node_modules /repo/apps/web/node_modules
COPY pnpm-workspace.yaml ./
COPY apps/web /repo/apps/web
COPY packages/module-sdk-ts /repo/packages/module-sdk-ts
COPY packages/shared-types /repo/packages/shared-types
# Modules ship their own frontend panels under modules/<id>/panel/ which the
# web app imports via the `@modules/*` alias. Copy them in so webpack can
# resolve those imports at build time, and recreate the host's
# `modules/node_modules` symlink so TypeScript can find type declarations
# for react / next / etc. when type-checking files under modules/.
COPY modules /repo/modules
RUN ln -s ../apps/web/node_modules /repo/modules/node_modules
WORKDIR /repo/apps/web
RUN pnpm build

# Runtime: copy only the standalone bundle. Next's standalone output already
# bundles its required node_modules.
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=builder /repo/apps/web/.next/standalone /app/
COPY --from=builder /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=builder /repo/apps/web/public /app/apps/web/public

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=5s \
  CMD wget -q --spider http://localhost:3000/processes || exit 1

CMD ["node", "apps/web/server.js"]
