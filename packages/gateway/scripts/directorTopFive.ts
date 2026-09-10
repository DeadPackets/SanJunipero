// Offline, $0. What the camera would have cut to, replayed off a recorded log — the phase-4
// gate counts identifiable moments out of this, and the scorer is pure, so the answer here is
// the answer the stream gave.
//
//   npx tsx packages/gateway/scripts/directorTopFive.ts <copy of world.db> --config=<sim.json> [days] [--shots]
//
// It also prints the whole shot list the camera would have run, and the pacing summary under it.
// A log does not record the config it ran under, so the run has to be told which world this was.
// Take a COPY: the script opens the file read-only, but a live world's WAL is not a snapshot.
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import {
  agentName,
  MINUTES_PER_DAY,
  SimConfigSchema,
  TICK_REAL_MS,
  tickToMoment,
  type NameIndex,
  type SimEvent,
} from '@sj/shared'
import { fold } from '@sj/engine/fold'
import { genesisState, type WorldState } from '@sj/engine/state'
import { unpackState } from '@sj/engine/store'
import { makeDirector } from '../src/stakes.js'
import { tileToScreen } from '../../web/src/render/iso.js'
import { sceneShot } from '../../web/src/render/sceneFraming.js'
import type { ZoomStop } from '../../web/src/render/camera.js'
import { quietRound } from '../../web/src/ui/autoCut.js'
import { cameraClaim, townAsleep } from '../../web/src/ui/directorCut.js'
import { shotLines, shotTape, summarise, summaryLines, tickFloor } from './shotList.js'

/** How many cuts a day is judged on. Three of five identifiable is the gate. */
const TOP = 5

/** Every event the scorer weighs, plus the scene rows it needs to hold a scene together. */
const READ_TYPES: readonly string[] = [
  'scene_opened',
  'scene_turned',
  'scene_line',
  'scene_closed',
  'agent_died',
  'agent_born',
  'partnership_formed',
  'partnership_dissolved',
  'law_ratified',
  'law_broken',
  'law_repealed',
  'discovery_made',
  'co_slept',
  'invitation_refused',
  'tie_let_go',
  'agent_spawned',
]

type Row = { seq: number; tick: number; type: string; payload: string }

const argv = process.argv.slice(2)
const args = argv.filter((a) => !a.startsWith('--'))
const listShots = argv.includes('--shots')
const dbPath = args[0]
const configPath = argv.find((a) => a.startsWith('--config='))?.slice('--config='.length)
if (dbPath === undefined || configPath === undefined || configPath === '') {
  console.error('usage: directorTopFive.ts <copy of world.db> --config=<sim.json> [days] [--shots]')
  process.exit(1)
}
const config = SimConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
const onlyDays = args[1] === undefined ? null : Number(args[1])
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
console.log(`world ${dbPath} folded under ${configPath}`)

// The cast, read off the spawn rows rather than off a folded state: a name is all the caption
// needs, and folding the whole world to get one would cost the log twice.
const names: Record<string, { name: string }> = {}
for (const r of db
  .prepare("SELECT payload FROM events WHERE type IN ('agent_spawned', 'agent_born')")
  .all() as { payload: string }[]) {
  const p = JSON.parse(r.payload) as { id?: string; name?: string }
  if (typeof p.id === 'string' && typeof p.name === 'string') names[p.id] = { name: p.name }
}
const index: NameIndex = names

// Partnerships, folded off the log for the one term that needs them.
const partner = new Map<string, string>()

const director = makeDirector(
  (id) => agentName(index, id),
  (id) => partner.get(id) ?? null,
)

const rows = db
  .prepare(
    `SELECT seq, tick, type, payload FROM events
      WHERE type IN (${READ_TYPES.map(() => '?').join(', ')}) ORDER BY seq`,
  )
  .all(...READ_TYPES) as Row[]

/** One cut, at the tick it was strongest, with what the log put under it. */
type Peak = { score: number; tick: number; why: string; sceneId: string | null; cast: string[] }

const perDay = new Map<number, Map<string, Peak>>()
/** What was weighted in the ten ticks before each cut, so a reader can argue with the score.
 *  Scoped to the cut's own scene: two talks in one minute are two moments, not one. */
const window = new Map<string, string[]>()
const recent: { tick: number; sceneId: string | null; line: string }[] = []

const said = (ev: SimEvent): string | null => {
  const p = ev.payload as Record<string, unknown>
  if (ev.type === 'scene_line') {
    const who = agentName(index, String(p.agentId))
    return `${who}: ${String(p.text).slice(0, 90)} [${String(p.move)}]`
  }
  if (ev.type === 'scene_opened' || ev.type === 'scene_turned') {
    const cast = (p.participants as string[] | undefined) ?? []
    return `${ev.type} ${String(p.kind)} stakes ${String(p.stakes)} — ${cast.map((id) => agentName(index, id)).join(', ')}`
  }
  if (ev.type === 'scene_closed') return `scene_closed — ${String(p.summary).slice(0, 120)}`
  if (ev.type === 'agent_spawned') return null
  return ev.type
}

let at = -1
const settle = (tick: number): void => {
  const day = Math.floor(tick / MINUTES_PER_DAY)
  if (onlyDays !== null && day >= onlyDays) return
  const f = director.frame(tick)
  if (f.cut === null) return
  const key = `${f.cut.sceneId ?? ''}\n${f.cut.agentIds.join(',')}`
  let today = perDay.get(day)
  if (today === undefined) {
    today = new Map()
    perDay.set(day, today)
  }
  const was = today.get(key)
  if (was !== undefined && was.score >= f.cut.score) return
  today.set(key, {
    score: f.cut.score,
    tick,
    why: f.cut.why,
    sceneId: f.cut.sceneId,
    cast: [...f.cut.agentIds],
  })
  const on = f.cut.sceneId
  window.set(
    `${day}\n${key}`,
    recent
      .filter((r) => tick - r.tick <= 10 && (on === null || r.sceneId === on))
      .map((r) => r.line),
  )
}

for (const r of rows) {
  if (at >= 0 && r.tick !== at) settle(at)
  at = r.tick
  const ev: SimEvent = { seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }
  const p = ev.payload as Record<string, unknown>
  if (ev.type === 'partnership_formed') {
    partner.set(String(p.aId), String(p.bId))
    partner.set(String(p.bId), String(p.aId))
  } else if (ev.type === 'partnership_dissolved') {
    partner.delete(String(p.aId))
    partner.delete(String(p.bId))
  }
  director.fold([ev])
  const line = said(ev)
  const sceneId = typeof p.id === 'string' && r.type.startsWith('scene_') ? p.id : null
  if (line !== null) recent.push({ tick: r.tick, sceneId, line })
  while (recent.length > 0 && r.tick - recent[0]!.tick > 10) recent.shift()
}
if (at >= 0) settle(at)

for (const day of [...perDay.keys()].sort((a, b) => a - b)) {
  const top = [...perDay.get(day)!.entries()]
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, TOP)
  console.log(`\n── day ${day} ──────────────────────────────────────────────`)
  for (const [key, cut] of top) {
    const { time } = tickToMoment(cut.tick)
    console.log(`\n  ${time}  ${String(Math.round(cut.score)).padStart(3)}  ${cut.why}`)
    console.log(`        ${cut.sceneId ?? '(no scene — a thing that happened to a body)'}`)
    for (const line of window.get(`${day}\n${key}`) ?? []) console.log(`        · ${line}`)
  }
  if (top.length === 0) console.log('  nothing scored')
}

// ── the shot list ──────────────────────────────────────────────────────────────────────────
// The gateway's cut run through the viewer's own floor, claim and shot grammar, one sim-minute
// at a time. The world is folded from the log's oldest snapshot, so the list starts where it does.
const snap = db.prepare('SELECT tick, seq, state FROM snapshots ORDER BY id LIMIT 1').get() as
  | { tick: number; seq: number; state: string | Buffer }
  | undefined
let state: WorldState = snap ? (unpackState(snap.state) as WorldState) : genesisState(config)
const fromTick = snap?.tick ?? 0
const lastTick =
  (db.prepare('SELECT MAX(tick) AS t FROM events').get() as { t: number | null }).t ?? 0
const toTick = onlyDays === null ? lastTick : Math.min(lastTick, onlyDays * MINUTES_PER_DAY - 1)

const shotDir = makeDirector(
  (id) => agentName(index, id),
  (id) => state.agents[id]?.partnerId ?? null,
)
const feed = db
  .prepare('SELECT seq, tick, type, payload FROM events WHERE seq > ? AND tick <= ? ORDER BY seq')
  .all(snap?.seq ?? 0, toTick) as Row[]

const NO_MOMENT: readonly string[] = []
/** How close the camera stands is a function of the frame it stands in, and an offline run has
 *  no window: the fit is taken for the widest frame the viewer builds for. */
const STAGE = { w: 1280, h: 720 }
/** Bodies under a walk action, which is the world saying they are going somewhere on purpose. */
const walking = new Set<string>()
const floor = tickFloor()
const round = quietRound()
const tape = shotTape((id) => agentName(index, id))
let feedAt = 0

const fittedFor = (ids: readonly string[]): ZoomStop | undefined =>
  sceneShot(
    ids.flatMap((id) => {
      const a = state.agents[id]
      return a === undefined ? [] : [tileToScreen(a.x, a.y)]
    }),
    STAGE,
  )?.stop

for (let tick = fromTick; tick <= toTick; tick++) {
  const batch: SimEvent[] = []
  while (feedAt < feed.length && feed[feedAt]!.tick <= tick) {
    const r = feed[feedAt]!
    const ev: SimEvent = { seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }
    state = fold(state, ev, config)
    const p = ev.payload as Record<string, unknown>
    if (typeof p.agentId === 'string') {
      if (ev.type === 'action_started') {
        if (p.verb === 'walk') walking.add(p.agentId)
        else walking.delete(p.agentId)
      } else if (ev.type === 'action_completed' || ev.type === 'action_interrupted') {
        walking.delete(p.agentId)
      }
    }
    batch.push(ev)
    feedAt++
  }
  shotDir.fold(batch)
  const d = shotDir.frame(tick)
  const indoors = new Set<string>()
  const outdoors: string[] = []
  for (const a of Object.values(state.agents)) {
    if (!a.alive) continue
    if (a.insideId === undefined) outdoors.push(a.id)
    else indoors.add(a.id)
  }
  const held = floor.hold(d.cut, tick * TICK_REAL_MS)
  const claim = cameraClaim(
    null,
    NO_MOMENT,
    indoors,
    { cut: held, quiet: d.quiet },
    townAsleep(state.agents),
    round(outdoors.sort(), tick),
    (id) => state.agents[id]?.insideId ?? null,
  )
  tape.at(tick, claim, {
    cut: held,
    walking,
    fitted: claim.by === 'cut' ? fittedFor(claim.cast) : undefined,
  })
}
const shotRows = tape.close(toTick)

console.log(
  `\n── shot list ── ticks ${fromTick} to ${toTick} ── framed for ${STAGE.w}x${STAGE.h} ──`,
)
if (listShots) for (const line of shotLines(shotRows)) console.log(line)
console.log('')
for (const line of summaryLines(summarise(shotRows, { fromTick, toTick }, floor.refused()))) {
  console.log(`  ${line}`)
}
console.log(`  cut held back ${tape.holds()} ticks its cast was indoors and not in one room`)
console.log(`  turned away by the shot's own floor ${tape.underFloor()}`)

db.close()
