# San Junipero, as a stream: one image, one process, one port.
#
# ★ WHY THE WHOLE WORKSPACE IS COPIED AND NOT JUST THE GATEWAY. pnpm workspaces link
# `@sj/gateway` to `@sj/shared`, `@sj/engine` and `@sj/forge` by symlink, and the gateway runs
# from TypeScript SOURCE under tsx — there is no build step that would flatten those links into
# one directory. A per-package prune (`pnpm deploy`) would have to bring all four packages plus
# their sources anyway, so it buys nothing but a longer Dockerfile.
#
# ★ WHY THERE ARE TWO STAGES ANYWAY. `@sj/web` pulls in vite, react, pixi and rolldown — some
# 200 MB that exist only to turn `src/` into `dist/`. The build stage keeps them; the runtime
# stage takes the built `dist/` and installs production dependencies only.

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
# ★ THE TREE IS COPIED WHOLE RATHER THAN RE-INSTALLED --prod, and that is a decision, not haste.
# `better-sqlite3` has no prebuild for this node/arch pair and compiles from source, so a second
# `pnpm install` in this stage would need python3/make/g++ back — more image than the
# devDependencies it set out to remove. What this stage DOES buy is leaving the apt toolchain
# behind, since it lives outside /app.
COPY --from=build /app /app

# The world writes its db here. Mount a volume to keep a town across restarts; without one the
# town is new every boot, which for a stream is a feature, not a bug.
RUN mkdir -p /app/packages/gateway/data
VOLUME ["/app/packages/gateway/data"]

ENV PORT=8080
EXPOSE 8080
# `serve.ts` traps SIGTERM and closes the world, so `docker stop` never truncates a write.
CMD ["pnpm", "--filter", "@sj/gateway", "serve"]
