import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import {
  MILESTONE_ICON, chronicleIcon, chronicleLine, type ChronicleLookup, type SimEvent,
} from '@sj/shared'
import { chronicleGlyph } from './importantFeed.js'
import { MARK_GLYPH, marksFrom } from './timelineMarks.js'
import { subjectFor } from './directorCut.js'
import {
  BROADCAST_WIDTHS, MACHINE_CHECKABLE, READINESS, STAGE_MIN_PX, TWITCH_SCALE, BADGE_WORD,
  captionAtScale, captionFloorPx, captionMinPx, captionReads, captionShortfall, figuresAreLive,
  kindWords, TWITCH_FRAME_H,
  layoutOffenders, machineWordOffenders, readinessReport, tickBadgeState,
  type Rails, type ReadinessLine, type StringSite,
} from './broadcastReady.js'
import { describeEvent } from './chronicleFormat.js'
import { chronicleLabel } from './importantFeed.js'
import { hoverLabel } from './interaction.js'
import { placeOf } from './place.js'
import { LAW_COPY } from './lawCopy.js'
import { EMPTY_COPY } from './townStats.js'
import { controlItems } from './controlBar.js'
import { stateWord, conditionsOf, CONDITION_WORD } from './status.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the eight conditions, stated', () => {
  it('names all eight and marks which four a machine can check', () => {
    expect(READINESS).toHaveLength(8)
    for (const id of MACHINE_CHECKABLE) {
      expect(READINESS.some((r) => r.startsWith(id)), id).toBe(true)
    }
    expect(MACHINE_CHECKABLE).toHaveLength(4)
  })

  it('renders a report with a MEASURED value in every row, pass or open', () => {
    const lines: ReadinessLine[] = [
      { id: 'R1', requirement: 'ten unattended minutes', measured: '10:00, 0 errors', pass: true },
      { id: 'R6', requirement: '>= 58fps', measured: '41 fps median', pass: false },
    ]
    const md = readinessReport(lines)
    expect(md).toContain('41 fps median')
    expect(md).toContain('OPEN')
    // a report whose only content is passes is not a measurement
    for (const l of lines) expect(md, l.id).toContain(l.measured)
  })
})

// ── R4 ────────────────────────────────────────────────────────────────────────────────────

// A town with every kind the engine can stand, including the two whose slugs have an
// underscore in them — which is the whole point of the scan.
const S = (id: string, kind: string, x: number, y: number, owner?: string) => ({
  id, kind, x, y, w: 1, h: 1, stage: 'complete', owner, builtBy: null,
  progressTicks: 0, hp: 10, integrity: 1,
})
const A = (id: string, name: string, x: number, y: number) => ({
  id, name, x, y, alive: true, insideId: null, asleep: false, ill: false, injuries: [],
  collapsedSinceTick: null, activity: { verb: 'walk' }, lastSpokeTick: undefined,
  needs: { hunger: 80, warmth: 80, energy: 80, social: 80 }, skills: {},
})
const TOWN = {
  tick: 480,
  terrain: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  agents: {
    a1: A('a1', 'Amara', 1, 1),
    a2: A('a2', 'Yusuf', 2, 2),
  },
  structures: {
    s_fire: S('s_fire', 'fire_pit', 0, 0),
    s_stone: S('s_stone', 'standing_stone', 1, 0),
    s_house: S('s_house', 'house', 2, 0, 'a1'),
    s_store: S('s_store', 'storehouse', 0, 1),
    s_wagon: S('s_wagon', 'wagon', 1, 2),
    s_scaf: S('s_scaf', 'scaffolding', 2, 1),
  },
  items: {}, crops: {}, weather: { kind: 'clear' },
} as unknown as WorldState

const ev = (type: string, payload: Record<string, unknown>): SimEvent =>
  ({ seq: 1, tick: 480, type, payload } as unknown as SimEvent)

/** Every string a broadcast surface can put in front of a viewer, with where it came from. */
export function broadcastStrings(state: WorldState): StringSite[] {
  const out: StringSite[] = []
  const push = (where: string, text: string | null | undefined): void => {
    if (typeof text === 'string' && text.length > 0) out.push({ where, text })
  }

  // the chronicle, over every structure in the town and every event type it renders
  for (const id of Object.keys(state.structures)) {
    push('chronicle', describeEvent(ev('structure_completed', { id }), state))
    push('chronicle', describeEvent(ev('fire_ignited', { structureId: id }), state))
    push('chronicle', describeEvent(ev('structure_planned', { builderId: 'a1', kind: state.structures[id]!.kind }), state))
    push('importantFeed', chronicleLabel(ev('structure_completed', { id }), state))
    push('importantFeed', chronicleLabel(ev('fire_ignited', { structureId: id }), state))
    push('hover', hoverLabel(state, 'structure', id))
    push('door tag', `Look inside — ${hoverLabel(state, 'structure', id) ?? ''}`)
  }
  push('chronicle', describeEvent(ev('agent_died', { agentId: 'a1', cause: 'hunger' }), state))
  push('chronicle', describeEvent(ev('weather_changed', { kind: 'storm' }), state))

  // where every living person is, in words
  for (const a of Object.values(state.agents)) {
    push('roster place', placeOf(state, a.id).words)
    push('roster state', stateWord(a as never))
    for (const c of conditionsOf(a as never)) push('roster condition', CONDITION_WORD[c])
    push('hover', hoverLabel(state, 'agent', a.id))
  }

  // the world laws, the empty states and every control label
  for (const [path, copy] of Object.entries(LAW_COPY)) {
    push(`law ${path} title`, copy.title)
    push(`law ${path} sentence`, copy.sentence)
    push(`law ${path} unit`, copy.unit)
  }
  for (const [k, v] of Object.entries(EMPTY_COPY)) push(`empty ${k}`, v)
  for (const item of controlItems({ lens: 'map', live: true, zoom: 1, following: null, insideId: null, hudHidden: false, townFits: true })) {
    push(`control ${item.id}`, item.label)
  }
  return out
}

describe('R4 · nothing on screen is a machine word, an id, or a number without a unit', () => {
  it('catches the shapes it is looking for', () => {
    expect(machineWordOffenders([{ where: 'x', text: 'The fire_pit is finished.' }])).toHaveLength(1)
    expect(machineWordOffenders([{ where: 'x', text: 'spoilage.days' }])).toHaveLength(1)
    expect(machineWordOffenders([{ where: 'x', text: 'structure_house_14_13' }]).length).toBeGreaterThan(0)
    expect(machineWordOffenders([{ where: 'x', text: 'It reached 4820 before dawn' }])).toHaveLength(1)
  })

  it('lets prose, times, counts and percentages through', () => {
    expect(machineWordOffenders([
      { where: 'x', text: 'The fire pit is finished.' },
      { where: 'x', text: 'Day 4 19:31' },
      { where: 'x', text: 'Food keeps for 3 days' },
      { where: 'x', text: '82% of the harvest' },
      { where: 'x', text: 'Amara is asleep in her own house' },
    ])).toEqual([])
  })

  it('finds a real corpus to check', () => {
    expect(broadcastStrings(TOWN).length).toBeGreaterThan(40)
  })

  it('has no offender in anything the broadcast can render', () => {
    expect(machineWordOffenders(broadcastStrings(TOWN))).toEqual([])
  })

  it('has ONE owner for turning a kind into prose', () => {
    expect(kindWords('fire_pit')).toBe('fire pit')
    expect(kindWords('standing_stone')).toBe('standing stone')
    expect(kindWords('house')).toBe('house')
  })
})

// ── R2 ────────────────────────────────────────────────────────────────────────────────────

/** Every caption a broadcast burns into the frame, and its source size in CSS px. */
const CAPTIONS: ReadonlyArray<{ what: string; px: number }> = [
  { what: 'speech bubble', px: 16 },          // FACE_INSTALL_PX
  { what: 'director subtitle', px: 0.95 * 16 },
  { what: 'director speaker name', px: Number.parseFloat(
    /\.subtitle-name\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(CSS)?.[1] ?? '0') * 16 },
  { what: 'filmstrip title', px: 14 },
]

describe('R2 · every caption survives the downscale to a 480px mobile player', () => {
  it('computes the scale and the floor from the frame, never from a fixed pixel count', () => {
    // the plan's 0.44 treats 1080 as the source WIDTH. 1080p is 1920 wide.
    expect(TWITCH_SCALE).toBe(0.25)
    expect(TWITCH_FRAME_H).toBe(270)
    expect(captionMinPx()).toBeCloseTo(5.4, 3)
    expect(captionFloorPx()).toBe(22)
  })

  it('agrees with the arithmetic on the two sizes either side of the line', () => {
    expect(captionAtScale(16)).toBe(4)
    expect(captionAtScale(24)).toBe(6)
  })

  it('names the captions it is measuring', () => {
    for (const c of CAPTIONS) expect(c.px, c.what).toBeGreaterThan(0)
  })

  // ★ THE NUMBER THAT BOUGHT THE SECOND LAYOUT, AND IT STAYS PINNED. Every burned-in caption
  // in the DESKTOP chrome is 12–16 px against a 22 px floor, so on a 480-wide phone they land
  // at 3.0–4.0 px where 5.4 px is needed. No token fixes it — 22 px chrome on a 1920 stage is
  // absurd for the person sitting in front of it — so `ui/broadcast.ts` is a second
  // composition rather than a bigger desktop, and `broadcast.test.ts` measures ITS captions at
  // the same 0.25 and finds no shortfall. This row is what the desktop still is, on purpose.
  it('MEASURES the desktop shortfall rather than asserting it away', () => {
    expect(captionShortfall(CAPTIONS)).toEqual([
      'speech bubble — 4.00px of 5.4px',
      'director subtitle — 3.80px of 5.4px',
      'director speaker name — 3.00px of 5.4px',
      'filmstrip title — 3.50px of 5.4px',
    ])
  })

  it('says what would close it, in one number', () => {
    expect(captionReads(captionFloorPx())).toBe(true)
    expect(captionReads(captionFloorPx() - 1)).toBe(false)
  })
})

// ── R7 ────────────────────────────────────────────────────────────────────────────────────

const rem = (v: string): number => Number.parseFloat(v) * (v.endsWith('rem') ? 16 : 1)
const RAILS: Rails = {
  panel: rem(/#panel-outlet\.open\s*\{[^}]*width:\s*([\d.]+rem)/.exec(CSS)?.[1] ?? '0'),
  stripCard: Number.parseFloat(/--strip-card:\s*(\d+)px/.exec(CSS)?.[1] ?? '0'),
  controlItem: 44,          // the touch floor every control clears
  controlCount: 11,         // the widest bar controlItems can produce
}

describe('R7 · the three broadcast widths hold the layout', () => {
  it('reads the rails off the sheet rather than repeating them', () => {
    expect(RAILS.panel).toBe(368)
    expect(RAILS.stripCard).toBe(168)
  })

  it('catches a width that does not fit', () => {
    expect(layoutOffenders(RAILS, [900]).length).toBeGreaterThan(0)
  })

  it('leaves a workable stage at every broadcast width, with the panel open', () => {
    expect(layoutOffenders(RAILS)).toEqual([])
    for (const w of BROADCAST_WIDTHS) expect(w - RAILS.panel, `${w}`).toBeGreaterThanOrEqual(STAGE_MIN_PX)
  })
})

// ── R8 ────────────────────────────────────────────────────────────────────────────────────

describe('R8 · a dropped socket never leaves a confident clock on screen', () => {
  it('marks the badge stale the moment the link is not open', () => {
    expect(tickBadgeState('online', true, true)).toBe('live')
    expect(tickBadgeState('online', false, true)).toBe('past')
    expect(tickBadgeState('reconnecting', true, true)).toBe('stale')
    expect(tickBadgeState('connecting', true, true)).toBe('stale')
    expect(tickBadgeState('connecting', true, false)).toBe('waking')
  })

  it('says a different word, never the live one, while it is stale', () => {
    expect(BADGE_WORD.stale).not.toBe(BADGE_WORD.live)
    expect(figuresAreLive('stale')).toBe(false)
    expect(figuresAreLive('live')).toBe(true)
  })

  it('is what the badge in App.tsx actually renders', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('tickBadgeState')
    expect(app).toContain('BADGE_WORD')
    // the old hard-coded pair is gone, so the badge cannot say `Now` with the socket down
    expect(app).not.toMatch(/\{live \? 'Now' : 'Back then'\}/)
  })

  it('marks the figures stale in the sheet too, so a viewer can see it', () => {
    expect(CSS).toContain('.tick-badge.stale')
  })
})

// ── R1 / R3 · the decidable halves, which were recorded as "unmeasured" whole ─────────────
//
// Neither line closes without a person: ten unattended minutes is a wall clock, and whether a
// stranger UNDERSTANDS in ten seconds is a judgement. But both rest on preconditions that are
// arithmetic, and both preconditions were false before this batch.

describe('R1 / R3 · what a machine can say about the two human lines', () => {
  const TOWN = ['amara', 'omar', 'salma', 'yusuf']

  it('R1 · the frame can never be subject-less while anybody is alive', () => {
    // 200 ticks of a town with nothing scored: `subjectFor` is TOTAL, so there is no second
    // where the director has nobody and the camera sits on empty ground.
    for (let tick = 0; tick < 200; tick++) {
      expect(subjectFor([], null, tick, TOWN), `tick ${tick}`).not.toBeNull()
    }
  })

  it('R3 · and the somebody it names is always somebody in the town', () => {
    for (let tick = 0; tick < 200; tick += 7) expect(TOWN).toContain(subjectFor([], null, tick, TOWN))
  })

  it('R1 · the load-time TypeError is gone, and its guard lives with the scene', () => {
    // `scene.test.ts` owns the proof: a closed scene answers `setTicking` without touching
    // `app.ticker`, which Pixi nulls in destroy(). Named here so R1's row has its citation.
    expect(readFileSync(new URL('../render/scene.ts', import.meta.url), 'utf8'))
      .toContain('export function sceneClock')
  })
})

// ── R5 · a death, a birth and a build each read differently without sound ─────────────────
//
// The verdict is a person's — whether three things READ differently is a judgement, and the
// protocol for it is in the report. But the NECESSARY condition is arithmetic, and it was
// recorded as "not machine-decidable" without the decidable half being measured. Every
// channel a silent viewer has is enumerated below and checked pairwise.

const R5_EVENTS = ['agent_died', 'agent_born', 'structure_completed'] as const

const R5_LOOK: ChronicleLookup = {
  agentName: (id) => ({ a1: 'Amara', a2: 'Yusuf', a3: 'Mira' } as Record<string, string>)[id] ?? id,
  structureKind: () => 'storehouse',
  mysteryProse: () => null,
}
const R5_PAYLOAD: Record<string, Record<string, unknown>> = {
  agent_died: { agentId: 'a1', cause: 'hunger' },
  agent_born: { id: 'a3', name: 'Mira', motherId: 'a1', fatherId: 'a2' },
  structure_completed: { id: 's1' },
}

const distinct = (xs: readonly string[]): boolean => new Set(xs).size === xs.length

describe('R5 · the three the town cannot say out loud', () => {
  const icons = R5_EVENTS.map((t) => chronicleIcon(t))
  const glyphs = icons.map((i) => JSON.stringify(chronicleGlyph(i).pixels))
  const lines = R5_EVENTS.map((t) => chronicleLine(ev(t, R5_PAYLOAD[t]!), R5_LOOK))
  const marks = R5_EVENTS.map((t) =>
    marksFrom({ chapters: [], milestones: [], moments: [], changes: [], events: [{ tick: 100, type: t }] })[0]!)

  it('gives each of the three a glyph of its own, and a different SHAPE, not just a name', () => {
    expect(icons).toEqual(['cross', 'spark', 'house'])
    expect(distinct(glyphs), 'two of the three draw the same pixels').toBe(true)
  })

  it('gives each of the three a sentence of its own', () => {
    for (const [i, l] of lines.entries()) expect(l, R5_EVENTS[i]).not.toBeNull()
    expect(distinct(lines as string[]), lines.join(' | ')).toBe(true)
  })

  it('gives each of the three a timeline mark of its own — kind, art and words', () => {
    expect(marks.map((m) => m.kind)).toEqual(['death', 'birth', 'built'])
    expect(distinct(marks.map((m) => m.words)), marks.map((m) => m.words).join(' | ')).toBe(true)
    expect(distinct(marks.map((m) => JSON.stringify(MARK_GLYPH[m.kind])))).toBe(true)
  })

  // WEIGHT IS NOT ONE OF R5's CHANNELS, and asserting it would have been wrong: a death and a
  // birth are both 14 on purpose — the weight decides what a crowded timeline keeps, not what
  // a mark looks like. Recorded so the next reader does not mistake the equality for a bug.
  it('weighs a death and a birth the same, and says why that is not a collision', () => {
    expect(marks[0]!.weight).toBe(marks[1]!.weight)
    expect(marks[2]!.weight).toBeLessThan(marks[0]!.weight)
  })

  // ★ MEASURED, AND IT IS NOT CLEAN. `spark` is the birth glyph AND the narrator milestone's
  // (`MILESTONE_ICON`), so the three R5 asks are pairwise distinct but a birth and a "first"
  // are not. The sentence beside it still separates them and the glyph is `aria-hidden`, so
  // nothing is announced wrongly — but the picture alone is ambiguous, which is exactly what
  // R5 asks about. Recorded rather than asserted away; the human pass decides whether it
  // matters, and this pin moves the moment the table does.
  it('records the one collision in the icon table', () => {
    expect(MILESTONE_ICON).toBe(chronicleIcon('agent_born'))
    expect(chronicleGlyph('spark').label).toBe('a first')
  })
})
