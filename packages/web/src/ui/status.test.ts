import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GAMIFICATION_BAN } from './townStats.js'
import { RosterPanelView } from './RosterPanel.js'
import { rosterRows2 } from './roster/rosterRow.js'
import type { WorldState } from '@sj/engine/state'
import {
  BANNED_STATUS_LITERALS, CONDITIONS, CONDITION_WORD, DRIVES, MACHINE_STATUS_IDS, NEED_LOW,
  STATES, STATE_PRIORITY, STATE_WORD, TALK_RECENT_TICKS,
  conditionsOf, drivesOf, stateWord, statusLiteralOffenders, statusOf,
  type AgentView, type Condition, type State,
} from './status.js'

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/** every non-test source file the viewer ships, read off disk */
function sourceFiles(): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue
      out.push({ path: relative(WEB_SRC, p), source: readFileSync(p, 'utf8') })
    }
  }
  walk(WEB_SRC)
  return out
}

const body = (over: Partial<AgentView> = {}): AgentView => ({
  alive: true, asleep: false, activity: null, ill: false, hp: 100, injuries: [],
  collapsedSinceTick: null,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  ...over,
})

// ── THE USER'S OWN EXAMPLE ──────────────────────────────────────────────────────────
describe('the duplicate, as a test', () => {
  const sleeper = body({ asleep: true, activity: null })

  it('a sleeping person is Asleep, once, and nothing that means rest is said twice', () => {
    expect(statusOf(sleeper)).toBe('asleep')
    expect(stateWord(sleeper)).toBe('Asleep')
    for (const c of conditionsOf(sleeper)) {
      expect(CONDITION_WORD[c].toLowerCase()).not.toMatch(/rest|sleep|awake/)
    }
  })

  it('the rendered roster says Asleep exactly once and “resting” not at all', () => {
    const state = {
      tick: 400,
      agents: {
        amara: {
          id: 'amara', name: 'Amara', x: 3, y: 3, alive: true, asleep: true, ageDays: 35 * 364,
          needs: { hunger: 80, energy: 40, warmth: 80, social: 80 },
          hp: 100, injuries: [], ill: false, skills: {}, activity: null,
          collapsedSinceTick: null, zeroHungerSinceTick: null,
        },
      },
      structures: {}, items: {}, crops: {},
      terrain: [[0] as unknown], weather: { kind: 'sunny', temperatureC: 12 },
      wildlife: { fish: 1, deer: 1 }, counters: { nextEntityId: 2 },
    } as unknown as WorldState
    const html = renderToStaticMarkup(createElement(RosterPanelView, {
      rows: rosterRows2(state, [], null, state.tick), gone: 0,
      sort: 'name' as const, openId: null, onSort: () => {}, onToggle: () => {},
    }))
    const text = html.replace(/<[^>]*>/g, ' ')
    // the landed card carried BOTH: an `asleep` badge and a `resting` doing-badge
    expect(text.match(/Asleep/gi)?.length).toBe(1)
    expect(text).not.toMatch(/resting/i)
    expect(text).not.toMatch(/awake/i)
  })
})

describe('STATES — one state per person, and the array IS the priority', () => {
  it('the priority table is the state list itself, not a second copy of it', () => {
    expect(STATE_PRIORITY).toEqual(STATES)
  })

  it('fires each state exactly once, one fixture per row', () => {
    const fixtures: Record<State, AgentView> = {
      gone: body({ alive: false }),
      collapsed: body({ collapsedSinceTick: 100 }),
      asleep: body({ asleep: true }),
      talking: body({ activity: { verb: 'speak' } }),
      eating: body({ activity: { verb: 'eat' } }),
      working: body({ activity: { verb: 'build' } }),
      walking: body({ activity: { verb: 'walk' } }),
      idle: body(),
    }
    for (const s of STATES) expect(statusOf(fixtures[s]), s).toBe(s)
    expect(Object.keys(fixtures).length).toBe(STATES.length)
  })

  it('a collapsed sleeper is collapsed; a dead agent is gone whatever else is true', () => {
    expect(statusOf(body({ asleep: true, collapsedSinceTick: 12 }))).toBe('collapsed')
    expect(statusOf(body({ alive: false, asleep: true, collapsedSinceTick: 12, activity: { verb: 'build' } })))
      .toBe('gone')
  })

  it('a WALKING TALKER is talking — the conversation is the fact worth reading', () => {
    const walker = body({ activity: { verb: 'walk' }, lastSpokeTick: 500 })
    expect(statusOf(walker)).toBe('walking')                    // without a clock, the verb rules
    expect(statusOf(walker, 505)).toBe('talking')               // in earshot of the last word
    expect(statusOf(walker, 500 + TALK_RECENT_TICKS + 1)).toBe('walking')
  })

  it('sleep outranks the conversation, and death outranks everything', () => {
    expect(statusOf(body({ asleep: true, lastSpokeTick: 500 }), 501)).toBe('asleep')
    expect(statusOf(body({ alive: false, lastSpokeTick: 500 }), 501)).toBe('gone')
  })

  it('the working word is the verb’s own gerund, and the others keep theirs', () => {
    expect(stateWord(body({ activity: { verb: 'build' } }))).toBe('Building')
    expect(stateWord(body({ activity: { verb: 'tend' } }))).toBe('Tending')
    expect(stateWord(body({ activity: { verb: 'make' } }))).toBe('Making')   // the t7 gerund rule
    expect(stateWord(body({ activity: { verb: 'walk' } }))).toBe('Walking')
    expect(stateWord(body())).toBe('Between things')
  })
})

describe('the two vocabularies can never become synonyms of each other', () => {
  it('both tables are total, and their WORDS are disjoint sets', () => {
    for (const s of STATES) expect(STATE_WORD[s].length, s).toBeGreaterThan(2)
    for (const c of CONDITIONS) expect(CONDITION_WORD[c].length, c).toBeGreaterThan(2)
    const states = new Set(Object.values(STATE_WORD).map((w) => w.toLowerCase()))
    const conds = Object.values(CONDITION_WORD).map((w) => w.toLowerCase())
    for (const w of conds) expect(states, w).not.toContain(w)
    expect(new Set(conds).size).toBe(conds.length)
    expect(states.size).toBe(STATES.length)
  })

  it('no word is machine vocabulary, carries a digit, or scores anything', () => {
    for (const w of [...Object.values(STATE_WORD), ...Object.values(CONDITION_WORD)]) {
      expect(w, w).not.toMatch(GAMIFICATION_BAN)
      expect(w, w).not.toMatch(/\d/)
      expect(w, w).not.toMatch(/_/)
      expect(w[0], w).toBe(w[0]!.toUpperCase())
    }
  })

  // `idle` stays a state id because charAnim, the moments player and this union all need it;
  // what must never happen is the id becoming the word a viewer reads.
  it('no printed word is one of the banned literals', () => {
    const banned = new Set(BANNED_STATUS_LITERALS.map((w) => w.toLowerCase()))
    for (const w of [...Object.values(STATE_WORD), ...Object.values(CONDITION_WORD)]) {
      expect(banned, w).not.toContain(w.toLowerCase())
    }
    expect(STATE_WORD.idle.toLowerCase()).not.toBe('idle')
  })
})

describe('conditionsOf — zero or more, and never a state', () => {
  it('a comfortable person carries none', () => {
    expect(conditionsOf(body())).toEqual([])
  })

  it('reads each condition off its own field', () => {
    const cases: Array<[Condition, AgentView]> = [
      ['unwell', body({ ill: true })],
      ['hurt', body({ injuries: [{ kind: 'serious', day: 2 }] })],
      ['hungry', body({ needs: { hunger: NEED_LOW - 1, energy: 80, warmth: 80, social: 80 } })],
      ['cold', body({ needs: { hunger: 80, energy: 80, warmth: NEED_LOW - 1, social: 80 } })],
      ['spent', body({ needs: { hunger: 80, energy: NEED_LOW - 1, warmth: 80, social: 80 } })],
      ['thirsty', body({ thirst: NEED_LOW - 1 })],
    ]
    for (const [c, a] of cases) expect(conditionsOf(a), c).toContain(c)
  })

  it('a world without C11’s fields simply never matches those rows', () => {
    expect(conditionsOf(body())).not.toContain('thirsty')
    expect(conditionsOf(body({ thirst: 90 }))).not.toContain('thirsty')
  })

  it('is deterministic and in CONDITIONS order, however many are true', () => {
    const wretched = body({
      ill: true, injuries: [{ kind: 'minor', day: 1 }], thirst: 1,
      needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    })
    const got = conditionsOf(wretched)
    expect(got).toEqual([...CONDITIONS])
    expect(conditionsOf(wretched)).toEqual(got)
  })
})

describe('drivesOf — the society lane’s hook, and an empty set renders nothing', () => {
  it('is empty today for every fixture, and the roster shows no placeholder for it', () => {
    expect([...DRIVES]).toEqual([])
    for (const a of [body(), body({ asleep: true }), body({ alive: false })]) {
      expect(drivesOf(a)).toEqual([])
    }
  })
})

// ── P17'S MECHANICAL GUARD ────────────────────────────────────────────────────────────────
describe('statusLiteralOffenders — the synonym bug cannot come back', () => {
  it('THE REAL SCAN: no shipped viewer file prints a banned status word', () => {
    const offenders = statusLiteralOffenders(sourceFiles())
    expect(offenders).toEqual([])
  })

  it('catches each banned word in the shape the defect actually had', () => {
    expect(statusLiteralOffenders([{ path: 'a.ts', source: "doing: a.activity ? g : 'resting'" }]))
      .toEqual(['a.ts'])
    expect(statusLiteralOffenders([{ path: 'b.tsx', source: "<span>{a.asleep ? 'asleep' : 'awake'}</span>" }]))
      .toEqual(['b.tsx'])
    expect(statusLiteralOffenders([{ path: 'c.tsx', source: "return <p>at rest forever</p>" }]))
      .toEqual(['c.tsx'])
    expect(statusLiteralOffenders([{ path: 'd.ts', source: "const s = 'Sleeping'" }]))
      .toEqual(['d.ts'])
  })

  it('leaves the machine vocabulary alone — an id is not a printed word', () => {
    // `idle` is a State id, an animation row and the moments player's stopped state; it is
    // never printed, because STATE_WORD.idle is 'Between things'.
    expect(MACHINE_STATUS_IDS).toContain('idle')
    expect(statusLiteralOffenders([{ path: 'e.ts', source: "const row = 'idle'" }])).toEqual([])
    expect(statusLiteralOffenders([{ path: 'f.ts', source: "cells['idle-se']" }])).toEqual([])
    // ...but the capitalised, printable form is still the bug
    expect(statusLiteralOffenders([{ path: 'g.ts', source: "label: 'Idle'" }])).toEqual(['g.ts'])
  })

  it('names every banned literal it is asked to catch, and reports each file once', () => {
    for (const lit of BANNED_STATUS_LITERALS) {
      const machine = (MACHINE_STATUS_IDS as readonly string[]).includes(lit)
      const src = `const x = '${lit}'`
      expect(statusLiteralOffenders([{ path: 'x.ts', source: src }]), lit)
        .toEqual(machine ? [] : ['x.ts'])
    }
    expect(statusLiteralOffenders([{ path: 'y.ts', source: "'resting' + 'awake'" }])).toEqual(['y.ts'])
  })
})
