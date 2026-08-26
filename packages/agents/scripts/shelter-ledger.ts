// Offline, $0. What the founding valley holds against how many bodies there are — the one
// arithmetic that decides whether a run can watch a town answer the cold at all.
import { DEFAULT_CONFIG, FOUNDER_IDS, isRoofedKind, type SimEvent } from '@sj/shared'
import {
  buildTicks,
  fold,
  genesisState,
  makeGenesisWorld,
  roomCapacity,
  shelterLedger,
} from '@sj/engine'

const CFG = DEFAULT_CONFIG
const g = makeGenesisWorld(CFG)
let s = genesisState(CFG, g.terrain)
let seq = 0
const ev = (type: string, payload: unknown): SimEvent => ({ seq: ++seq, tick: 0, type, payload })
for (const e of g.events) s = fold(s, ev(e.type, e.payload), CFG)
for (const [i, f] of FOUNDER_IDS.entries()) {
  s = fold(s, ev('agent_spawned', { id: f, name: f, x: 60 + i, y: 90, ageDays: 7300 }), CFG)
}

for (const st of Object.values(s.structures).sort((a, b) => a.id.localeCompare(b.id))) {
  const roofed = isRoofedKind(CFG, st.kind)
  const left = st.stage === 'construction' ? buildTicks(CFG, st.kind) - st.progressTicks : 0
  console.log(
    st.id.padEnd(12),
    st.kind.padEnd(11),
    st.stage.padEnd(13),
    roofed && st.stage === 'complete' ? `holds ${roomCapacity(st)}` : '',
    st.stage === 'construction'
      ? `${st.progressTicks}/${buildTicks(CFG, st.kind)} — ${left} ticks left`
      : '',
  )
}
console.log('---')
console.log('ledger', JSON.stringify(shelterLedger(s, CFG)))
