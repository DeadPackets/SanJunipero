// $0 sanity for the motive probe's world: no roof anywhere, a spot the town keeps for one,
// and a founder with wood in hand who can actually raise it. Prints the prose too.
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  groundForBuilding,
  isExposed,
  makeGenesisWorld,
  RngStreams,
  TickLoop,
  type LawQueue,
  type TickHandler,
  type WorldState,
} from '@sj/engine'
import { DAYS_PER_YEAR, DEFAULT_CONFIG, isRoofedKind, type SimConfig } from '@sj/shared'
import { EngineBridge } from '../src/runtime/bridge.js'
import { makeablesLine, perceptionToProse } from '../src/prompt/prose.js'

const config: SimConfig = DEFAULT_CONFIG
const ROOFED = new Set(
  Object.keys(config.structures.recipes).filter((k) => isRoofedKind(config, k)),
)
const START_TICK = 18 * 60

const db = openDb(':memory:')
const store = new EventStore(db)
const g = makeGenesisWorld(config)
let state: WorldState = genesisState(config, g.terrain)
const dropped = new Set<string>()
const doors: { x: number; y: number }[] = []
for (const e of g.events) {
  const p = e.payload as Record<string, unknown>
  if (e.type === 'structure_planned' && ROOFED.has(String(p.kind))) {
    dropped.add(String(p.id))
    doors.push({ x: Number(p.x), y: Number(p.y) + Number(p.h ?? 1) })
    continue
  }
  if (e.type === 'structure_completed' && dropped.has(String(p.id))) continue
  state = fold(state, store.append(state.tick, e.type, e.payload), config)
}
const IDS = ['amara', 'yusuf', 'nadia', 'omar', 'salma']
IDS.forEach((id, i) => {
  const at = doors[i] ?? doors[0]!
  state = fold(
    state,
    store.append(state.tick, 'agent_spawned', {
      id,
      name: id,
      x: at.x,
      y: at.y,
      sex: 'f',
      ageDays: 30 * DAYS_PER_YEAR,
    }),
    config,
  )
  state = fold(
    state,
    store.append(state.tick, 'item_spawned', {
      id: `wood_${id}`,
      kind: 'wood',
      qty: 10,
      loc: { t: 'agent', id },
      owner: id,
    }),
    config,
  )
})

const lawQueue: LawQueue = []
const worldTick = createWorldTick(config, rngOf(), lawQueue)
function rngOf(): RngStreams {
  return new RngStreams('motive-sanity')
}
const loop = new TickLoop({
  store,
  state,
  rng: rngOf(),
  config,
  startTick: START_TICK,
  realMsPerTick: 0,
  onTick: (c) => {
    handler(c)
  },
})
const bridge = new EngineBridge({ loop, store, simConfig: config })
const handler: TickHandler = bridge.wrapTickHandler(({ emit }) => {
  for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
})
loop.step()

const roofs = Object.values(loop.state.structures).filter((s) => ROOFED.has(s.kind))
console.log(`roofs standing: ${roofs.length} (must be 0)`)
console.log(
  `other structures: ${Object.values(loop.state.structures)
    .map((s) => s.kind)
    .sort()
    .join(', ')}`,
)
const spot = groundForBuilding(loop.state)
console.log(
  `ground the town keeps for a roof: ${spot === null ? 'NONE — the probe cannot work' : `(${spot.x}, ${spot.y})`}`,
)
console.log(
  `founders at: ${IDS.map((id) => `${id}(${loop.state.agents[id]!.x},${loop.state.agents[id]!.y})`).join(' ')}`,
)
if (spot !== null) {
  const d = IDS.map(
    (id) =>
      Math.abs(loop.state.agents[id]!.x - spot.x) + Math.abs(loop.state.agents[id]!.y - spot.y),
  )
  console.log(`walk to that ground: ${d.join(', ')} tiles`)
}

// Walk one founder there and raise it — the whole path the probe needs to be open.
if (spot !== null) {
  void bridge.submit('yusuf', { verb: 'walk', params: { x: spot.x, y: spot.y } })
  for (
    let i = 0;
    i < 400 && (loop.state.agents.yusuf!.x !== spot.x || loop.state.agents.yusuf!.y !== spot.y);
    i++
  )
    loop.step()
  const y = loop.state.agents.yusuf!
  console.log(`yusuf walked to (${y.x}, ${y.y}) in ${loop.tick - START_TICK - 1} ticks`)
  let verdict = 'no answer'
  void bridge.submit('yusuf', { verb: 'build', params: { kind: 'house' } }, (r) => {
    verdict = JSON.stringify(r)
  })
  loop.step()
  console.log(`build house: ${verdict}`)
  for (let i = 0; i < 600; i++) loop.step()
  console.log(
    `structures now: ${Object.values(loop.state.structures)
      .map((s) => `${s.kind}:${s.stage}`)
      .sort()
      .join(', ')}`,
  )
}

// And the night. Step to 21:00 and read what a body out in it perceives.
while (loop.tick < 21 * 60 + 30) loop.step()
console.log(
  `\nexposed at ${Math.floor(loop.tick / 60)}:00 — ${IDS.map((id) => `${id}=${isExposed(loop.state, config, id) ? 'YES' : 'no'}`).join(' ')}`,
)
const p = bridge.perception('amara')
const prose = perceptionToProse(p, undefined, {
  isWalkable: (x, y) => bridge.isWalkable(x, y),
  isEdible: (k) => bridge.isEdible(k),
  waterAtHand: () => bridge.waterAtHand('amara'),
  nearestWater: (x, y) => bridge.nearestWater(x, y),
  nearestFood: (x, y) => bridge.nearestFood(x, y),
})
console.log(`\n--- what amara reads at ${Math.floor(loop.tick / 60)}:${loop.tick % 60} ---`)
console.log(`${prose} ${makeablesLine(bridge.makeables(), bridge.groundForBuilding())}`)
