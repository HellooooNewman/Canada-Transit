FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @ttc/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
CMD ["sh", "-c", "cd apps/web && node build/index.js"]
