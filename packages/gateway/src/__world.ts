// Throwaway launcher for the honest-world lane's looking pass. Ports 8787/5173 are held by
// processes this lane did not start. Removed before the final tree.
import { startDevWorld } from './devWorld.js'

const rings = Number(process.env['SJ_DEV_RINGS'] ?? 3)
void startDevWorld({
  ingest: true, map: 'showcase', rings, interiors: true, builders: true, bridge: true,
  port: 9633, dbPath: 'data/honest-world.db',
}).then(({ gateway }) => {
  console.log(`honest-world dev world up on ws://localhost:${gateway.port}/ws  rings=${rings}`)
})
