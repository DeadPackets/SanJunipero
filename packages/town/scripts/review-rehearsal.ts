import Database from 'better-sqlite3'
import { resolve, join } from 'node:path'
import { createGateway } from '@sj/gateway'
import { devTerrain } from '../src/devWorld.js'

const [directory, portText = '8776'] = process.argv.slice(2)
const port = Number(portText)
if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Usage: review-rehearsal.ts ORCHARD_RUN_DIRECTORY [PORT]')
const run = resolve(directory)
const ops = new Database(join(run, 'minds', '_ops.db'), {
  readonly: true,
  fileMustExist: true,
})
try {
  const gateway = await createGateway({
    dbPath: join(run, 'world.db'),
    terrain: devTerrain('orchard'),
    agentDbDir: join(run, 'minds'),
    narratorDbPath: join(run, 'minds', '_narrator.db'),
    staticDir: resolve('packages/web/dist'),
    port,
    adminPort: null,
    paused: () => true,
    replayMsPerTick: 1000,
    usageSource: () => ({ live: true, db: ops, mindStatus: 'disabled' }),
  })
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      if (closing) return
      closing = true
      void gateway.close().finally(() => ops.close())
    })
  console.log(`Recorded rehearsal: http://127.0.0.1:${port}/moment/0/12:35 — minds disabled`)
} catch (error) {
  ops.close()
  throw error
}
