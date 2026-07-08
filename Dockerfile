# syntax=docker/dockerfile:1

# ---- workspace manifests (shared by build + prod-deps) ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/core/package.json packages/core/
COPY packages/github/package.json packages/github/
COPY packages/linear/package.json packages/linear/

# ---- compile TypeScript ----
FROM base AS build
RUN npm ci
COPY tsconfig.json tsconfig.base.json ./
COPY apps/gateway/tsconfig.json apps/gateway/
COPY packages/core/tsconfig.json packages/core/
COPY packages/github/tsconfig.json packages/github/
COPY packages/linear/tsconfig.json packages/linear/
COPY apps/gateway/src apps/gateway/src
COPY packages/core/src packages/core/src
COPY packages/github/src packages/github/src
COPY packages/linear/src packages/linear/src
RUN npm run build

# ---- production dependencies only ----
FROM base AS prod-deps
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/apps/gateway/package.json apps/gateway/
COPY --from=base /app/packages/core/package.json packages/core/
COPY --from=base /app/packages/github/package.json packages/github/
COPY --from=base /app/packages/linear/package.json packages/linear/
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/github/dist packages/github/dist
COPY --from=build /app/packages/linear/dist packages/linear/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1
CMD ["node", "apps/gateway/dist/index.js"]
