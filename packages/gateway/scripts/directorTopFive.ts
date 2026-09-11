// Offline, $0. What the camera would have cut to, replayed off a recorded log — the phase-4
// gate counts identifiable moments out of this, and the scorer is pure, so the answer here is
// the answer the stream gave.
//
//   npx tsx packages/gateway/scripts/directorTopFive.ts <copy of world.db> --config=<sim.json> [days] [--shots] [--threads]
//
// It also prints the whole shot list the camera would have run, and the pacing summary under it.
// `--threads` replays the story fold over the same pass: the census of every story open on each
// sim-day, the ribbon it would have shown, and how often that ribbon's head changed.
// A log does not record the config it ran under, so the run has to be told which world this was.
// Take a COPY: the script opens the file read-only, but a live world's WAL is not a snapshot.
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import {
  agentName,
  BODY_HALF_LIFE_TICKS,
  MINUTES_PER_DAY,
  SimConfigSchema,
  THREAD_TOP_N,
  TICK_REAL_MS,
  tickToMoment,
  type NameIndex,
  type SimEvent,
  type StakeTerm,
  type ThreadRow,
} from '@sj/shared'
import { fold } from '@sj/engine/fold'
import { genesisState, type WorldState } from '@sj/engine/state'
import { unpackState } from '@sj/engine/store'
import { makeDirector, type Pay } from '../src/stakes.js'
import { makeThreads } from '../src/threads.js'
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
const listThreads = argv.includes('--threads')
const dbPath = args[0]
const configPath = argv.find((a) => a.startsWith('--config='))?.slice('--config='.length)
if (dbPath === undefined || configPath === undefined || configPath === '') {
  console.error(
    'usage: directorTopFive.ts <copy of world.db> --config=<sim.json> [days] [--shots] [--threads]',
  )
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

// Every payment the director makes, before the story fold's cap sees it: what the cap turned
// away is the difference between these two, and it is only countable here. Keyed the way the
// fold keys it, which is per edge and never per scene.
const story = makeThreads()
const offers: { tick: number; term: StakeTerm; weight: number; key: string }[] = []
const watched: Pay = (cast, term, weight, tick, sceneId) => {
  const who = [...new Set(cast)].filter((id) => id.length > 0).sort()
  offers.push({ tick, term, weight, key: who.join(' ') })
  story.pay(cast, term, weight, tick, sceneId)
}

const director = makeDirector(
  (id) => agentName(index, id),
  (id) => partner.get(id) ?? null,
  listThreads ? watched : undefined,
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

// ── the story ribbon ──────────────────────────────────────────────────────────────────────
/** What a sim-day looked like to the ribbon: every story open on it, the rows it ended on, and
 *  how often its head changed hands. */
type DayThreads = {
  open: Map<string, { row: ThreadRow; at: number }>
  ribbon: ThreadRow[]
  /** The last tick the ribbon was read on this day, which on the log's final day is not the
   *  day's own last tick: reading an age at a tick the run never reached ages every row. */
  at: number
  changes: number
  closed: number
  alive: number
  /** Ticks the ribbon had a head at all, ticks that head had been paid inside a body half life,
   *  and ticks a cold head held the ribbon while a live story was running under it. */
  ticks: number
  liveHead: number
  coldOverLive: number
  /** Ticks each story held the head, so the worst capsule's share of the day can be read
   *  against the design's own bar of half a day. */
  headTicks: Map<string, number>
}

const threadDays = new Map<number, DayThreads>()
const closedSeen = new Set<string>()
let ribbonTop: string | null = null
let framedTo = -1
/** How long each head held, in ticks, so a handover shorter than the floor is countable. */
const holds: number[] = []
let holdFrom = -1

const dayThreads = (day: number): DayThreads => {
  let d = threadDays.get(day)
  if (d === undefined) {
    d = {
      open: new Map(),
      ribbon: [],
      at: 0,
      changes: 0,
      closed: 0,
      alive: 0,
      ticks: 0,
      liveHead: 0,
      coldOverLive: 0,
      headTicks: new Map(),
    }
    threadDays.set(day, d)
  }
  return d
}

/** The ribbon drawn on every tick up to here, which is the finest cadence the gateway can pump
 *  at and the only one a replay can claim is the viewer's. */
const census = (toTick: number): void => {
  if (!listThreads) return
  for (let t = framedTo + 1; t <= toTick; t++) {
    const day = Math.floor(t / MINUTES_PER_DAY)
    if (onlyDays !== null && day >= onlyDays) break
    const rows = story.census(t)
    if (rows.length === 0) continue
    const d = dayThreads(day)
    for (const row of rows) {
      if (row.state === 'closed') {
        if (!closedSeen.has(row.id)) {
          closedSeen.add(row.id)
          d.closed += 1
        }
        continue
      }
      d.open.set(row.id, { row, at: t })
    }
    const head = rows[0]!
    if (head.id !== ribbonTop) {
      d.changes += 1
      if (holdFrom >= 0) holds.push(t - holdFrom)
      holdFrom = t
    }
    ribbonTop = head.id
    d.headTicks.set(head.id, (d.headTicks.get(head.id) ?? 0) + 1)
    d.ribbon = rows.slice(0, THREAD_TOP_N)
    d.at = t
    d.alive = rows.length
    d.ticks += 1
    const live = (row: ThreadRow): boolean => t - row.lastPaidTick <= BODY_HALF_LIFE_TICKS
    if (live(head)) d.liveHead += 1
    else if (rows.some(live)) d.coldOverLive += 1
  }
  framedTo = toTick
}

for (const r of rows) {
  if (onlyDays !== null && r.tick >= onlyDays * MINUTES_PER_DAY) break
  if (at >= 0 && r.tick !== at) {
    settle(at)
    // Up to the tick BEFORE this one, which is where the gateway frames the ribbon: an idle tick
    // stepped after the next tick's payments reads heat the town had not paid yet.
    census(r.tick - 1)
  }
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
  if (listThreads) story.fold([ev])
  const line = said(ev)
  const sceneId = typeof p.id === 'string' && r.type.startsWith('scene_') ? p.id : null
  if (line !== null) recent.push({ tick: r.tick, sceneId, line })
  while (recent.length > 0 && r.tick - recent[0]!.tick > 10) recent.shift()
}
if (at >= 0) {
  settle(at)
  census(at)
}

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

if (listThreads) {
  const cast = (ids: readonly string[]): string => {
    const shown = ids.slice(0, 3).map((id) => agentName(index, id))
    return ids.length > 3 ? `${shown.join(', ')} +${ids.length - 3}` : shown.join(', ')
  }
  const pct = (row: ThreadRow): string =>
    row.peak <= 0 ? '  -' : `${String(Math.round((row.heat / row.peak) * 100)).padStart(3)}%`
  const line = (row: ThreadRow, at: number): string =>
    `  ${row.id.padEnd(4)} ${row.state.padEnd(8)} ${((at - row.openedTick) / MINUTES_PER_DAY)
      .toFixed(1)
      .padStart(4)}d ${pct(row)} of ${row.peak.toFixed(1).padStart(6)}  ` +
    `${cast(row.members).padEnd(34)} ${row.terms.join(', ')}`

  console.log('\n── threads ────────────────────────────────────────────────────────────')
  console.log('  a story that merged away mid-day is still counted as having run that day')
  for (const day of [...threadDays.keys()].sort((a, b) => a - b)) {
    const d = threadDays.get(day)!
    console.log(
      `\n  day ${day}: ${d.open.size} stories ran, ${d.alive} still standing at the end of it, ` +
        `${d.closed} closed, ribbon head changed ${d.changes} times`,
    )
    console.log(
      `    the head was a story paid in the last ${BODY_HALF_LIFE_TICKS} ticks on ` +
        `${d.liveHead} of ${d.ticks} ticks, and a cold head sat over a live story on ` +
        `${d.coldOverLive}`,
    )
    const most = Math.max(0, ...d.headTicks.values())
    console.log(
      `    the capsule that held the head longest held it for ${most} of ${d.ticks} ticks, ` +
        `${Math.round((most / Math.max(1, d.ticks)) * 100)}% of the day, against a bar of 50%`,
    )
    console.log('    id   state      age  heat            members                     terms')
    for (const { row, at } of [...d.open.values()].sort((a, b) => b.row.heat - a.row.heat)) {
      console.log(`  ${line(row, at)}`)
    }
    console.log(`    the ribbon at the end of day ${day}:`)
    for (const row of d.ribbon) console.log(`    ${line(row, d.at)}`)
  }

  const sorted = [...holds].sort((a, b) => a - b)
  console.log(
    `\n  the ribbon changed head ${holds.length} times: shortest hold ${sorted[0] ?? 0} ticks, ` +
      `median ${sorted[Math.floor(sorted.length / 2)] ?? 0}, and ` +
      `${holds.filter((h) => h * TICK_REAL_MS < 12_000).length} under the 12 second floor`,
  )

  const s = story.stats()
  console.log(
    `\n  ${s.made} stories opened, ${s.merged} merged away, ${s.dropped} dropped as the coldest, ` +
      `${closedSeen.size} closed`,
  )

  // The cap is one payment per term per tick per edge, at the highest weight offered. Offered
  // against taken, grouped the way the fold groups it, is what it turned away.
  type Cap = { offered: number; taken: number }
  const perTick = new Map<string, Cap>()
  const byTerm = new Map<StakeTerm, Cap>()
  const byStory = new Map<string, Cap>()
  const councilOf = new Map<string, number>()
  for (const o of offers) {
    const k = `${o.tick}|${o.key}|${o.term}`
    const was = perTick.get(k)
    if (was === undefined) perTick.set(k, { offered: o.weight, taken: o.weight })
    else {
      was.offered += o.weight
      was.taken = Math.max(was.taken, o.weight)
    }
  }
  for (const [k, c] of perTick) {
    const [, key, term] = k.split('|') as [string, string, StakeTerm]
    const t = byTerm.get(term) ?? { offered: 0, taken: 0 }
    t.offered += c.offered
    t.taken += c.taken
    byTerm.set(term, t)
    const st = byStory.get(key) ?? { offered: 0, taken: 0 }
    st.offered += c.offered
    st.taken += c.taken
    byStory.set(key, st)
    if (term === 'council') councilOf.set(key, (councilOf.get(key) ?? 0) + c.taken)
  }
  const all = [...byTerm.values()].reduce(
    (a, c) => ({ offered: a.offered + c.offered, taken: a.taken + c.taken }),
    { offered: 0, taken: 0 },
  )
  console.log('\n  ── the one payment per term per tick per edge cap ──')
  console.log('    term                    offered    taken   turned away')
  for (const [term, c] of [...byTerm.entries()].sort((a, b) => b[1].offered - a[1].offered)) {
    const cut = c.offered === 0 ? 0 : Math.round(((c.offered - c.taken) / c.offered) * 100)
    console.log(
      `    ${term.padEnd(24)}${c.offered.toFixed(0).padStart(7)}${c.taken
        .toFixed(0)
        .padStart(9)}${`${cut}%`.padStart(11)}`,
    )
  }
  console.log(
    `    ${'every term'.padEnd(24)}${all.offered.toFixed(0).padStart(7)}${all.taken
      .toFixed(0)
      .padStart(
        9,
      )}${`${all.offered === 0 ? 0 : Math.round(((all.offered - all.taken) / all.offered) * 100)}%`.padStart(11)}`,
  )
  const heaviest = [...councilOf.entries()].sort((a, b) => b[1] - a[1])[0]
  if (heaviest === undefined) console.log('\n  no council ever sat in this log')
  else {
    const c = byStory.get(heaviest[0])!
    console.log(
      `\n  the heaviest council story (${heaviest[0]}): offered ${c.offered.toFixed(0)}, ` +
        `took ${c.taken.toFixed(0)}`,
    )
  }
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
