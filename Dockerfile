# The whole workspace is copied: pnpm links @sj/* by symlink and the town runs from TS source
# under tsx, so there is nothing to prune to. Two stages only to leave vite/react/pixi behind.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
# better-sqlite3 and sharp ship prebuilds for linux/glibc; node-gyp is the fallback path.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sj/web build

FROM node:24-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
# Copied whole rather than re-installed --prod: better-sqlite3 has no prebuild for this
# node/arch pair, so a second install would need the python3/make/g++ toolchain back.
COPY --from=build /app /app

# Without a volume the town dies with the container — see compose.yaml.
RUN mkdir -p /app/packages/town/data
VOLUME ["/app/packages/town/data"]

ENV PORT=8080
EXPOSE 8080
# `serve.ts` traps SIGTERM and closes the world, so `docker stop` never truncates a write.
CMD ["pnpm", "--filter", "@sj/town", "serve"]
