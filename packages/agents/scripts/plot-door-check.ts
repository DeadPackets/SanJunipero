// Offline, $0. `groundForBuilding` answers with a 1x1 claim's door. Does that tile actually
// work for the wider kinds a mind can now raise? A named place that refuses the mind standing
// on it is a wasted act generator, which is the one thing this lane exists to kill.
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import {
  claimInWorld,
  fold,
  genesisState,
  groundForBuilding,
  makeGenesisWorld,
  submitIntent,
} from '@sj/engine'

const CFG = DEFAULT_CONFIG
const g = makeGenesisWorld(CFG)
let base = genesisState(CFG, g.terrain)
let seq = 0
const ev = (type: string, payload: unknown): SimEvent => ({ seq: ++seq, tick: 0, type, payload })
for (const e of g.events) base = fold(base, ev(e.type, e.payload), CFG)

const told = groundForBuilding(base)!
console.log('the prose names', told)

for (const [kind, wood] of [
  ['house', 10],
  ['cottage', 15],
  ['farmhouse', 20],
] as const) {
  const row = CFG.structures.recipes[kind]!
  const claim = claimInWorld(base, { along: row.w, deep: row.h })!
  let s = fold(
    base,
    ev('agent_spawned', { id: 'b', name: 'b', x: told.x, y: told.y, ageDays: 10000 }),
    CFG,
  )
  s = fold(
    s,
    ev('item_spawned', { id: 'w', kind: 'wood', qty: wood, loc: { t: 'agent', id: 'b' } }),
    CFG,
  )
  const r = submitIntent(s, CFG, 'b', 'build', { kind })
  console.log(
    kind.padEnd(10),
    'own door',
    JSON.stringify(claim.door),
    r.ok ? 'ACCEPTED standing where the prose said' : `REFUSED: ${r.reason}`,
  )
}
