# The whole workspace is copied: pnpm links @sj/* by symlink and the town runs from TS source
# under tsx, so there is no --prod install to fall back to. Two stages to leave the apt toolchain
# behind; the browser and lint packages go by hand below.

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
# The browser and lint toolchains, deleted by hand: `pnpm prune --prod` would take `tsx` with it,
# and tsx is what runs the town. Deleted HERE, not in the runtime stage — a later layer hides the
# bytes but still ships them. The viewer is already built into packages/web/dist.
RUN rm -rf \
  node_modules/.pnpm/onnxruntime-web@* \
  node_modules/.pnpm/pixi.js@* \
  node_modules/.pnpm/@biomejs+* \
  node_modules/.pnpm/rolldown@* \
  node_modules/.pnpm/@rolldown+* \
  node_modules/.pnpm/lightningcss* \
  node_modules/.pnpm/react-dom@* \
  node_modules/.pnpm/force-graph@* \
  node_modules/.pnpm/knip@* \
  node_modules/.pnpm/*eslint* \
  node_modules/.pnpm/vite@*
# onnxruntime-node stays (the live embedder loads it), but `dist/binding.js` requires exactly
# `bin/napi-v6/${process.platform}/…`, so the win32 and darwin trees can never open here.
RUN rm -rf node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/win32 \
  node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/darwin

FROM node:24-slim AS runtime
# Prepared here so a boot never reaches the npm registry for the package manager.
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
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
