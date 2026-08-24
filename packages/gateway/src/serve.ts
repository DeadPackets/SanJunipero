// ★ THE STREAM. One process, one port, one address: the world ticks here, the socket serves it
// here, and the built viewer is handed to a browser from the same origin here. Everything before
// this file was a localhost dev split — a gateway on 8787 and a vite server on 5173 proxying to
// it — which is two terminals and cannot be given to a stranger.
//
// This is deliberately NOT a second copy of the world: it is `startDevWorld` with the built
// client bolted to the same http server, so the town a viewer watches over the internet is
// byte-for-byte the town a lane watches on localhost.
//
//   pnpm stream                 the product town, one ring, port 8080
//   PORT=9000 SJ_RINGS=3 …      pick the port and how far the town is platted
//
// ★ WHAT THIS DOES NOT DO: spend money. The founders are a SCRIPTED cast (`founders.ts`), not
// LLM minds — `createGateway` has never had a live-mind world behind it in this repo. See the
// streaming report; the cost of the world this serves is $0.00/hour.
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TOWN_RINGS_GENESIS } from '@sj/shared'
import { startDevWorld, type DevMapKind } from './devWorld.js'

export const STREAM_PORT = 8080
export const CLIENT_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url))

/** The one instruction a person needs when the viewer has not been built yet. */
export const BUILD_FIRST = 'pnpm --filter @sj/web build'

const intEnv = (name: string, fallback: number, min: number): number => {
  const asked = Number(process.env[name] ?? fallback)
  if (Number.isInteger(asked) && asked >= min) return asked
  if (process.env[name] !== undefined) console.log(`stream: ${name}=${process.env[name]} ignored; using ${fallback}`)
  return fallback
}

export async function main(): Promise<void> {
  if (!existsSync(`${CLIENT_DIST}index.html`)) {
    console.error(`stream: no viewer at ${CLIENT_DIST}\nstream: build it first — ${BUILD_FIRST}`)
    process.exitCode = 1
    return
  }
  const port = intEnv('PORT', STREAM_PORT, 1)
  const rings = intEnv('SJ_RINGS', TOWN_RINGS_GENESIS, 1)
  const map: DevMapKind = process.env['SJ_MAP'] === 'scripted' ? 'scripted' : 'showcase'
  const interiors = process.env['SJ_INTERIORS'] === '1'

  let world
  try {
    world = await startDevWorld({ ingest: true, map, rings, interiors, port, staticDir: CLIENT_DIST })
  } catch (e) {
    // A taken port is the single most common way this command fails, and a raw EADDRINUSE
    // stack says nothing an operator can act on.
    const busy = (e as { code?: string }).code === 'EADDRINUSE'
    console.error(busy
      ? `stream: port ${port} is already in use — pick another with PORT=…`
      : `stream: could not start — ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
    return
  }
  console.log(`stream: the town is open at http://localhost:${world.gateway.port}/`)

  // A stream is a long-running process and a container stops it with a signal; without this the
  // world dies mid-write and the next boot reads a half-flushed db.
  const stop = (signal: string): void => {
    console.log(`stream: ${signal} — closing the town`)
    void world.stop().then(() => process.exit(0))
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
