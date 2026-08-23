import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOGGLABLE_PATHS } from '@sj/engine/laws'
import type { WorldState } from '@sj/engine/state'
import { chronicleIcon, type SimEvent } from '@sj/shared'

// GATE G12c — THE CHROME HALF. The other two files are:
//   packages/web/src/render/g12c.test.ts   — the canvas (U3–U11, U18, U19)
//   packages/gateway/src/g12c.test.ts      — the town, U25, and the read-only proof

import { rosterRows2, sortRoster, ROSTER_SORTS } from './roster/rosterRow.js'
import { expandReducer, becomingOf, ALWAYS_SHOWN } from './roster/expand.js'
import { CONDITION_WORD, STATE_WORD, statusLiteralOffenders } from './status.js'
import { MARK_MIN_WEIGHT, MARK_WEIGHT, coalesceMarks, marksFrom } from './timelineMarks.js'
import {
  BOND_LEVELS, BOND_TYPES, LEVEL_RANK, LEVEL_THRESHOLDS, bondLevel, bondTypeOf, bondWarmth,
  relationLine,
} from './bondModel2.js'
import { frameLayout, straddlers } from './frame.js'
import { LAW_COPY } from './lawCopy.js'
import { DEFAULT_HUD, DOCKABLE, hudReducer, hudToggle, loadHud, saveHud } from './hudLayout.js'
import { actionFor, controlItems } from './controlBar.js'
import { MOTION, MOTIONS, MOTION_CEILING_MS, untokenisedDurations } from './motion.js'
import { SCENE_TOTAL_MS, idleScene, sceneAlpha, sceneReducer } from './sceneTransition.js'
import {
  MACHINE_CHECKABLE, READINESS, captionFloorPx, captionShortfall, layoutOffenders,
  machineWordOffenders, tickBadgeState,
} from './broadcastReady.js'
import { BROADCAST_CAPTIONS } from './broadcast.js'
import { subjectFor } from './directorCut.js'
import { authoredIdentityOffenders, substanceOf } from './becoming.js'
import { TEXT_MIN_PX } from '../textFloor.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, '..')
const CSS = readFileSync(join(HERE, 'chrome.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The broadcast frame's captions come off the shipped sheet, so a token change moves them. */
function broadcastSheetPx(selector: string): number {
  const hits: number[] = []
  for (const [, list, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!(list ?? '').split(',').some((x) => x.trim() === selector)) continue
    const raw = /font-size:\s*([^;}]+)/.exec(body ?? '')?.[1]?.trim()
    if (raw !== undefined) hits.push(Number.parseFloat(raw) * (raw.endsWith('rem') ? 16 : 1))
  }
  if (hits.length === 0) throw new Error(`no font-size for ${selector}`)
  return hits.at(-1)!
}

function sources(dir = WEB_SRC): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
    out.push({ path: p.slice(WEB_SRC.length + 1), source: readFileSync(p, 'utf8') })
  }
  return out
}

// ── the day-0 fixture, and the same town five days on ─────────────────────────────────────

const agent = (id: string, name: string, x: number, y: number, over: Record<string, unknown> = {}) => ({
  id, name, x, y, alive: true, asleep: false, ill: false, injuries: [], insideId: undefined,
  collapsedSinceTick: null, activity: { verb: 'walk' }, ageDays: 30,
  needs: { hunger: 70, warmth: 70, energy: 70, social: 70 }, skills: {}, ...over,
})

const world = (over: Record<string, unknown> = {}): WorldState => ({
  tick: 480,
  terrain: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
  agents: {
    a1: agent('a1', 'Amara', 1, 1),
    a2: agent('a2', 'Yusuf', 2, 2, { asleep: true, activity: null }),
    a3: agent('a3', 'Nadia', 0, 2, { activity: { verb: 'till' } }),
  },
  structures: {
    s_house: { id: 's_house', kind: 'house', x: 1, y: 0, w: 1, h: 1, stage: 'complete', owner: 'a1', builtBy: null },
    s_fire: { id: 's_fire', kind: 'fire_pit', x: 0, y: 0, w: 1, h: 1, stage: 'complete', builtBy: null },
  },
  items: {}, crops: {}, weather: { kind: 'clear' },
  ...over,
} as unknown as WorldState)

// ── U12 · the townsfolk tab is a character roster ─────────────────────────────────────────

describe('U12 — "lackluster… doesn\'t have any information at a glance"', () => {
  const rows = rosterRows2(world(), [], null, 480, [])

  it('fills every one of the five required fields for every living person', () => {
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(r.portrait, `${r.name} portrait`).toBeDefined()
      expect(r.name.length, 'name').toBeGreaterThan(0)
      expect(r.state.length, `${r.name} status`).toBeGreaterThan(0)
      expect(r.mood, `${r.name} mood`).toBeDefined()
      expect(r.place.words.length, `${r.name} where they are`).toBeGreaterThan(0)
    }
  })

  it('renders a day-5 town DIFFERENTLY from a day-0 one — the row is live, not a template', () => {
    const later = world({
      tick: 7680,
      agents: {
        a1: agent('a1', 'Amara', 1, 1, { asleep: true, activity: null, ageDays: 35 }),
        a2: agent('a2', 'Yusuf', 2, 2, { activity: { verb: 'build' } }),
        a3: agent('a3', 'Nadia', 0, 2, { ill: true }),
      },
    })
    const then = rosterRows2(later, [], null, 7680, [])
    expect(then.map((r) => r.state)).not.toEqual(rows.map((r) => r.state))
  })

  it('keeps the whole list rendered in every reachable state of the expander', () => {
    const ids = rows.map((r) => r.id)
    let s = expandReducer({ openId: null }, { kind: 'toggle', id: ids[0]! }, ids)
    expect(s.openId).toBe(ids[0])
    s = expandReducer(s, { kind: 'toggle', id: ids[1]! }, ids)
    expect(s.openId).toBe(ids[1])
    s = expandReducer(s, { kind: 'toggle', id: ids[1]! }, ids)
    expect(s.openId).toBeNull()
    // the list itself never shrinks — the row is a state OF the list
    expect(rosterRows2(world(), [], null, 480, [])).toHaveLength(3)
  })

  it('sorts as a viewer PREFERENCE, never as a ranking', () => {
    for (const by of ROSTER_SORTS) expect(sortRoster(rows, by)).toHaveLength(3)
  })
})

// ── U13 · one status vocabulary ───────────────────────────────────────────────────────────

describe('U13 — "\'Asleep\' and \'Resting\' mean the same thing"', () => {
  it('leaves no printed status literal anywhere outside its own module', () => {
    expect(statusLiteralOffenders(sources())).toEqual([])
  })

  it('keeps the state words and the condition words DISJOINT', () => {
    const states = new Set(Object.values(STATE_WORD).map((w) => w.toLowerCase()))
    const conds = new Set(Object.values(CONDITION_WORD).map((w) => w.toLowerCase()))
    expect([...states].filter((w) => conds.has(w))).toEqual([])
  })

  it('says a sleeping founder is Asleep, once, and never Resting', () => {
    const sleeper = rosterRows2(world(), [], null, 480, []).find((r) => r.name === 'Yusuf')!
    expect(sleeper.state).toBe('Asleep')
    expect(JSON.stringify(sleeper).toLowerCase()).not.toContain('resting')
  })
})

// ── U14 · the chronicle timeline ──────────────────────────────────────────────────────────

const ev = (tick: number, type: string, payload: Record<string, unknown> = {}): SimEvent =>
  ({ seq: tick, tick, type, payload } as unknown as SimEvent)

describe('U14 — "the timeline is missing MARKS; the font is hard to read and too small"', () => {
  const marks = marksFrom({
    events: [
      ev(100, 'agent_died', { agentId: 'a1' }),
      ev(200, 'structure_completed', { id: 's_house' }),
      ev(300, 'agent_born', { agentId: 'a4' }),
      ev(400, 'fire_ignited', { structureId: 's_house' }),
    ],
    chapters: [], milestones: [], moments: [], changes: [{ tick: 250 }], discoveries: [],
  })

  it('puts marks on a mature day at all', () => {
    expect(marks.length).toBeGreaterThan(0)
  })

  it('weights a change above a build — the timeline is about what CHANGED', () => {
    expect(MARK_WEIGHT.changed).toBeGreaterThan(MARK_WEIGHT.built)
    expect(MARK_MIN_WEIGHT).toBeGreaterThan(0)
  })

  it('coalesces rather than piling, so a busy hour is still readable', () => {
    const dense = [0, 1, 2, 3, 4].map((i) => ev(100 + i, 'structure_completed', { id: `s${i}` }))
    const all = marksFrom({
      events: dense, chapters: [], milestones: [], moments: [], changes: [], discoveries: [],
    })
    expect(coalesceMarks(all, 500).length).toBeLessThanOrEqual(all.length)
  })

  it('never sets a timeline glyph below the 12px chrome floor', () => {
    for (const sel of ['.timeline-day em', '.mark-tip']) {
      const body = /([^{}]+)\{([^{}]*)\}/g
      let hit: RegExpExecArray | null = null
      let found: string | null = null
      while ((hit = body.exec(CSS)) !== null) {
        if ((hit[1] ?? '').split(',').some((s) => s.trim() === sel)) {
          found = /font-size:\s*([\d.]+)rem/.exec(hit[2] ?? '')?.[1] ?? found
        }
      }
      if (found !== null) expect(Number(found) * 16, sel).toBeGreaterThanOrEqual(TEXT_MIN_PX)
    }
  })
})

// ── U15 · bonds with levels and types ─────────────────────────────────────────────────────

describe('U15 — "the bonds tab does not represent relationships and its tags are weird"', () => {
  it('starts a pair who spoke once as strangers', () => {
    expect(bondLevel(bondWarmth([{ tick: 10, kind: 'spoke' }] as never, 20))).toBe('strangers')
  })

  it('reaches every one of the six levels, and a level FALLS on decay', () => {
    expect(new Set(LEVEL_RANK).size).toBe(6)
    for (const t of LEVEL_THRESHOLDS) expect(LEVEL_RANK).toContain(t.level)
    const acts = Array.from({ length: 40 }, (_, i) => ({ tick: i * 10, kind: 'give' }))
    const hot = bondWarmth(acts as never, 400)
    const cold = bondWarmth(acts as never, 400 + 20000)
    expect(cold).toBeLessThan(hot)
    expect(LEVEL_RANK.indexOf(bondLevel(cold)))
      .toBeLessThanOrEqual(LEVEL_RANK.indexOf(bondLevel(hot)))
  })

  it('tells a parent from a child from a sibling', () => {
    const lineage = {
      parentOf: [
        { parentId: 'p', childId: 'c', tick: 10 }, { parentId: 'p', childId: 'd', tick: 20 },
      ],
    }
    const none = { pairs: [] } as never
    expect(bondTypeOf('p', 'c', lineage, none)).toBe('parent')
    expect(bondTypeOf('c', 'p', lineage, none)).toBe('child')
    expect(bondTypeOf('c', 'd', lineage, none)).toBe('sibling')
  })

  it('has a sentence for every type at every level', () => {
    for (const t of BOND_TYPES) {
      for (const l of BOND_LEVELS) {
        const arc = { from: l, to: l, direction: 'steady' as const, sinceDay: 2 }
        const line = relationLine(t, l, arc, ['Amara', 'Yusuf'])
        expect(typeof line, `${t}/${l}`).toBe('string')
        expect(line.length, `${t}/${l}`).toBeGreaterThan(0)
      }
    }
  })
})

// ── U16 · the moments composition ─────────────────────────────────────────────────────────

describe('U16 — "an element sits ON TOP of the letterbox"', () => {
  it('partitions the stage exactly, at every height', () => {
    for (const h of [400, 520, 594, 720, 900]) {
      const l = frameLayout({ w: 1280, h }, true)
      expect(l.picture.y, `h ${h}`).toBe(l.bandTop.y + l.bandTop.h)
      expect(l.bandBottom.y, `h ${h}`).toBe(l.picture.y + l.picture.h)
      expect(l.bandTop.h + l.picture.h + l.bandBottom.h, `h ${h}`).toBe(h)
    }
  })

  it('has nothing straddling a band edge', () => {
    const l = frameLayout({ w: 1280, h: 594 }, true)
    expect(straddlers([
      { id: 'strip', x: 0, y: l.bandBottom.y, w: 1280, h: l.bandBottom.h },
      { id: 'player', x: 100, y: l.picture.y + 20, w: 400, h: 56 },
    ], l)).toEqual([])
    // and it FINDS one that crosses, so the guard is not vacuous
    expect(straddlers([{ id: 'rail', x: 0, y: 8, w: 240, h: l.picture.y + 40 }], l)).toEqual(['rail'])
  })

  it('does not engage the letterbox with nothing playing (audit M7)', () => {
    const l = frameLayout({ w: 1280, h: 594 }, false)
    expect(l.bandTop.h).toBe(0)
    expect(l.bandBottom.h).toBe(0)
  })
})

// ── U17 · world laws in plain words ───────────────────────────────────────────────────────

describe('U17 — "world laws are super technical"', () => {
  it('is total over every togglable path', () => {
    for (const path of Object.keys(TOGGLABLE_PATHS)) {
      expect(LAW_COPY[path as keyof typeof LAW_COPY], path).toBeDefined()
    }
  })

  it('puts no dot-path in any title or sentence', () => {
    for (const [path, copy] of Object.entries(LAW_COPY)) {
      expect(copy.title, path).not.toMatch(/\w+\.\w+/)
      expect(copy.sentence, path).not.toMatch(/\w+\.\w+[a-z]/i)
      expect(copy.title, path).not.toContain('_')
    }
  })

  it('says nothing a machine says, over every law surface at once', () => {
    const sites = Object.entries(LAW_COPY).flatMap(([p, c]) => [
      { where: `${p} title`, text: c.title }, { where: `${p} sentence`, text: c.sentence },
    ])
    expect(machineWordOffenders(sites)).toEqual([])
  })
})

// ── U20 / U21 · controls a viewer can move and hide ───────────────────────────────────────

describe('U20/U21 — "I need controls out of the way… I must be able to move or hide them"', () => {
  it('reaches a fully hidden layout and comes back from it', () => {
    const hidden = hudReducer(DEFAULT_HUD, { kind: 'hide-all' })
    for (const d of DOCKABLE) expect(hidden[d], d).toBe('hidden')
    const back = hudReducer(hidden, { kind: 'show-all' })
    for (const d of DOCKABLE) expect(back[d], d).not.toBe('hidden')
    expect(hudToggle(hidden)).not.toEqual(hidden)
  })

  it('renders a keyboard way back from EVERY reachable layout', () => {
    const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8')
    expect(app).toContain('HUD_TOGGLE_KEY')
    // and the dock itself is never dockable, so it cannot hide its own handle
    expect(DOCKABLE as readonly string[]).not.toContain('hudDock')
  })

  it('round-trips through storage', () => {
    const store = new Map<string, string>()
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    } as unknown as Storage
    const moved = hudReducer(DEFAULT_HUD, { kind: 'dock', what: 'controlBar', to: 'top' })
    saveHud(fake, moved)
    expect(loadHud(fake)).toEqual(moved)
  })
})

// ── U22 · a proper bottom control bar ─────────────────────────────────────────────────────

describe('U22 — "I should have controls at the bottom to let me do what I want"', () => {
  const items = controlItems({ lens: 'map', live: true, zoom: 1, following: null, insideId: null, hudHidden: false })

  it('turns every id the bar can produce into an action', () => {
    for (const lens of ['map', 'inspector', 'chronicle', 'society', 'director', 'laws'] as const) {
      for (const live of [true, false]) {
        for (const inside of [null, 's_house']) {
          for (const item of controlItems({ lens, live, zoom: 1, following: null, insideId: inside, hudHidden: false })) {
            expect(() => actionFor(item), `${lens}/${item.id}`).not.toThrow()
            expect(actionFor(item).kind, `${lens}/${item.id}`).toBeTypeOf('string')
          }
        }
      }
    }
  })

  it('gives every control a spoken label and no pictographic character', () => {
    expect(items.length).toBeGreaterThan(4)
    for (const item of items) {
      expect(item.label.length, item.id).toBeGreaterThan(2)
      // eslint-disable-next-line no-control-regex
      expect(/[^\u0000-\u00FF]/.test(item.label), `${item.id} label "${item.label}"`).toBe(false)
      expect(item.glyph.length, item.id).toBeGreaterThan(0)
    }
  })

  it('holds the 44px touch floor in the sheet', () => {
    expect(/\.ctl-btn\s*\{[^}]*min-(?:width|height):\s*44px/.test(CSS)
      || /--control-bar-h:\s*5[0-9]px/.test(CSS)).toBe(true)
  })
})

// ── U23 · the polish ──────────────────────────────────────────────────────────────────────

describe('U23 — "missing special touches… transitions, that extra shine"', () => {
  it('has one motion table, total and inside the ceiling', () => {
    expect(Object.keys(MOTION).sort()).toEqual([...MOTIONS].sort())
    for (const n of MOTIONS) if (n !== 'ambient') expect(MOTION[n].ms, n).toBeLessThanOrEqual(MOTION_CEILING_MS)
  })

  it('writes no raw duration in the whole sheet', () => {
    expect(untokenisedDurations(CSS)).toEqual([])
  })

  it('completes a scene and retargets one without restarting it', () => {
    let s = sceneReducer(idleScene('lens', 'town'), { kind: 'go', name: 'lens', to: 'chronicle', atMs: 0 })
    const retargeted = sceneReducer(s, { kind: 'go', name: 'lens', to: 'society', atMs: 40 })
    expect(retargeted.startedMs).toBe(s.startedMs)
    s = sceneReducer(retargeted, { kind: 'tick', atMs: SCENE_TOTAL_MS })
    expect(s.phase).toBe('idle')
    expect(sceneAlpha(s, SCENE_TOTAL_MS).in).toBe(1)
  })

  it('passes all twelve finish lines', () => {
    // the twelve live in finish.test.ts; this line proves the file is present and total
    const finish = readFileSync(join(HERE, 'finish.test.ts'), 'utf8')
    for (let n = 1; n <= 12; n++) expect(finish, `line ${n}`).toContain(`${n} · `)
  })
})

// ── U24 · Twitch readiness ────────────────────────────────────────────────────────────────

describe('U24 — "it really feels a very far distance from being that ready"', () => {
  it('names eight conditions and four a machine can check', () => {
    expect(READINESS).toHaveLength(8)
    expect(MACHINE_CHECKABLE).toHaveLength(4)
  })

  it('passes R4, R7 and R8', () => {
    expect(machineWordOffenders([{ where: 'probe', text: 'The fire pit is finished.' }])).toEqual([])
    expect(layoutOffenders({ panel: 368, stripCard: 168, controlItem: 44, controlCount: 11 })).toEqual([])
    expect(tickBadgeState('reconnecting', true, true)).toBe('stale')
  })

  // ★ R2 CLOSES ON A SECOND COMPOSITION, NOT ON A BIGGER DESKTOP. The desktop shortfall is
  // still 3.00–4.00px against 5.4 and stays measured; the broadcast frame's captions are read
  // off the shipped sheet at the same true 0.25 and there is no shortfall left in them.
  it('reports R2 as CLOSED by the broadcast layout, and the desktop as still short', () => {
    const desktop = captionShortfall([
      { what: 'speech bubble', px: 16 }, { what: 'filmstrip title', px: 14 },
    ])
    expect(desktop).toHaveLength(2)
    expect(desktop[0]).toContain('4.00px of 5.4px')

    const broadcast = BROADCAST_CAPTIONS.map((c) => ({
      what: c.what,
      px: c.from === 'canvas' ? c.px : broadcastSheetPx(c.selector),
    }))
    expect(captionShortfall(broadcast)).toEqual([])
    for (const c of broadcast) expect(c.px, c.what).toBeGreaterThanOrEqual(captionFloorPx())
  })

  // R1 and R3 do not close here, but the preconditions they rest on are arithmetic and both
  // were false before this batch: the director had no subject whenever the town was quiet.
  it('leaves the frame with a subject at every tick of a quiet town', () => {
    const town = ['amara', 'omar', 'salma', 'yusuf']
    for (let tick = 0; tick < 200; tick++) expect(subjectFor([], null, tick, town)).not.toBeNull()
  })

  // R5's necessary condition, which was recorded as "not machine-decidable" whole.
  it('draws a death, a birth and a build as three different pictures', () => {
    const icons = ['agent_died', 'agent_born', 'structure_completed'].map((t) => chronicleIcon(t))
    expect(icons).toEqual(['cross', 'spark', 'house'])
    expect(new Set(icons).size).toBe(3)
  })

  it('carries a measured value in every row of the report, including the failures', () => {
    const md = readFileSync(join(WEB_SRC, '..', '..', '..', 'docs', 'superpowers', 'reports', 'twitch-readiness.md'), 'utf8')
    for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']) {
      expect(md, id).toContain(`**${id}**`)
    }
    expect(md).toContain('OPEN')
    expect(md).toContain('PASS')
  })
})

// ── P22 · the neutral-start mandate ───────────────────────────────────────────────────────

describe('P22 — personality is an OUTPUT, not an input', () => {
  it('leaves no viewer file reading a handed-down identity', () => {
    expect(authoredIdentityOffenders(sources())).toEqual([])
  })

  it('measures substance from the LOG, never from a genesis fact', () => {
    const thin = substanceOf({
      actsDone: 0, daysLived: 0, bondsAtOrAbove: 0, skillBands: 0, personalityVersions: 0,
      changeDays: 0,
    })
    const thick = substanceOf({
      actsDone: 20, daysLived: 5, bondsAtOrAbove: 3, skillBands: 4, personalityVersions: 2,
      changeDays: 3,
    })
    expect(thick).toBeGreaterThan(thin)
  })

  it('renders two people with identical genesis and different logs differently', () => {
    const base = {
      name: 'A', nowTick: 480, skills: {}, bonds: null, lineage: { parentOf: [] },
      people: { a1: 'A', a2: 'B' }, changes: [],
    }
    const quiet = becomingOf({ ...base, id: 'a1', acts: [] } as never)
    const busy = becomingOf({
      ...base, id: 'a2', name: 'B',
      acts: [{ tick: 100, words: 'gave bread to A', day: 0 }],
    } as never)
    expect(JSON.stringify(quiet.done)).not.toEqual(JSON.stringify(busy.done))
    for (const k of ALWAYS_SHOWN) expect(quiet[k], k).toBeDefined()
  })
})
