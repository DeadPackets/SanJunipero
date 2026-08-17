import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GAMIFICATION_BAN } from './townStats.js'
import { diffLines } from './diffLines.js'
import { InspectorBodyView } from './InspectorPanel.js'
import {
  AUTHORED_IDENTITY_FIELDS, CHANGE_EMPTY, REMOVED_PLACEHOLDERS, SKILLS_EMPTY,
  SUBSTANCE_FULL, SUBSTANCE_WEIGHTS, THOUGHT_EMPTY,
  authoredIdentityOffenders, changeLog, substanceOf, type SubstanceInput,
} from './becoming.js'

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

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

const ZERO: SubstanceInput = {
  actsDone: 0, daysLived: 0, bondsAtOrAbove: 0, skillBands: 0, personalityVersions: 0, changeDays: 0,
}

/** mulberry32 — a seeded sample, so a random test that fails fails the same way twice */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ★ THE MANDATE THIS MODULE EXISTS FOR (U26–U31, P22). The default arm starts everyone
// NEUTRAL, so nothing in the UI may display an authored personality field, and the one number
// the gate reads must measure what a RUN made of a person — never what they were handed.
describe('substanceOf — a measure of becoming, not of being', () => {
  it('★ GENESIS FACTS CANNOT INFLATE IT: name, age and temperament are not even inputs', () => {
    expect(Object.keys(ZERO).sort()).toEqual([
      'actsDone', 'bondsAtOrAbove', 'changeDays', 'daysLived', 'personalityVersions', 'skillBands',
    ])
    for (const k of Object.keys(ZERO)) {
      expect(k, k).not.toMatch(/^(name|age|sex|traits?|temperament|background|persona)$/i)
      expect(AUTHORED_IDENTITY_FIELDS, k).not.toContain(k)
    }
    // `personalityVersions` counts how many times the town REWROTE the document, which is a
    // run-produced number; the document's own contents are never an input.
    expect(SUBSTANCE_FULL.personalityVersions).toBeGreaterThan(1)
  })

  it('a person a run has done nothing with measures exactly zero', () => {
    expect(substanceOf(ZERO)).toBe(0)
  })

  it('is monotonic non-decreasing in every single term', () => {
    for (const k of Object.keys(ZERO) as Array<keyof SubstanceInput>) {
      let last = -1
      for (const n of [0, 1, 2, 5, 10, 50, 1000]) {
        const v = substanceOf({ ...ZERO, [k]: n })
        expect(v, `${k}=${n}`).toBeGreaterThanOrEqual(last)
        last = v
      }
      expect(substanceOf({ ...ZERO, [k]: 1 }), k).toBeGreaterThan(0)
    }
  })

  it('stays inside [0, 1] over a thousand sampled inputs', () => {
    const r = rng(83)
    for (let i = 0; i < 1000; i++) {
      const v = substanceOf({
        actsDone: Math.floor(r() * 500), daysLived: Math.floor(r() * 200),
        bondsAtOrAbove: Math.floor(r() * 30), skillBands: Math.floor(r() * 20),
        personalityVersions: Math.floor(r() * 40), changeDays: Math.floor(r() * 60),
      })
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('every share is positive, and the shares add up to exactly one whole person', () => {
    const total = Object.values(SUBSTANCE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
    for (const k of Object.keys(ZERO) as Array<keyof SubstanceInput>) {
      expect(SUBSTANCE_WEIGHTS[k], k).toBeGreaterThan(0)
      expect(SUBSTANCE_FULL[k], k).toBeGreaterThan(0)
    }
  })

  it('a negative or absurd input cannot push it out of range', () => {
    expect(substanceOf({ ...ZERO, actsDone: -50 })).toBe(0)
    expect(substanceOf({
      actsDone: 1e9, daysLived: 1e9, bondsAtOrAbove: 1e9,
      skillBands: 1e9, personalityVersions: 1e9, changeDays: 1e9,
    })).toBe(1)
  })

  // P22.4: two people the run treated differently cannot measure the same
  it('a run that did more with one person than another says so', () => {
    const quiet = { ...ZERO, daysLived: 5 }
    const lived = { ...quiet, actsDone: 30, bondsAtOrAbove: 3, changeDays: 2 }
    expect(substanceOf(lived)).toBeGreaterThan(substanceOf(quiet))
  })
})

describe('changeLog — the Character tab re-framed as what MOVED', () => {
  const rows = [
    { version: 1, day: 0, doc: 'a\nb', edit: 'first written' },
    { version: 2, day: 3, doc: 'a\nc', edit: 'after the fire' },
    { version: 3, day: 6, doc: 'a\nc\nd', edit: 'after the harvest' },
  ]

  it('is newest first, because the latest is the one that is true now', () => {
    expect(changeLog(rows).map((e) => e.version)).toEqual([3, 2, 1])
  })

  it('uses the landed differ, not a second one', () => {
    const log = changeLog(rows)
    expect(log[0]!.diff).toEqual(diffLines(rows[1]!.doc, rows[2]!.doc))
    expect(log[1]!.diff).toEqual(diffLines(rows[0]!.doc, rows[1]!.doc))
  })

  it('★ A SINGLE VERSION IS NOT A CHARACTER SHEET: it has moved nothing, and says so', () => {
    const log = changeLog([rows[0]!])
    expect(log.length).toBe(1)
    expect(log[0]!.diff).toEqual([])
    expect(CHANGE_EMPTY).toContain('has changed')
    expect(CHANGE_EMPTY).not.toMatch(/\d/)
  })

  it('an empty history is an empty log, never a fabricated first entry', () => {
    expect(changeLog([])).toEqual([])
  })

  it('is order-independent — the endpoint’s ordering cannot change what it says', () => {
    expect(changeLog([...rows].reverse())).toEqual(changeLog(rows))
  })

  it('carries the day and the edit the world recorded, and invents neither', () => {
    const log = changeLog(rows)
    expect(log.map((e) => e.day)).toEqual([6, 3, 0])
    expect(log.map((e) => e.edit)).toEqual(['after the harvest', 'after the fire', 'first written'])
  })
})

// ── THE BAN, MECHANICALLY ─────────────────────────────────────────────────────────────────
describe('authoredIdentityOffenders — no panel reads a handed-down identity', () => {
  it('THE REAL SCAN: no shipped viewer file reads one of these fields', () => {
    expect(authoredIdentityOffenders(sourceFiles())).toEqual([])
  })

  it('catches a read however it is spelled', () => {
    expect(authoredIdentityOffenders([{ path: 'a.ts', source: 'const t = agent.traits' }])).toEqual(['a.ts'])
    expect(authoredIdentityOffenders([{ path: 'b.ts', source: "const t = agent['backstory']" }])).toEqual(['b.ts'])
    expect(authoredIdentityOffenders([{ path: 'c.ts', source: 'const { persona } = agent' }])).toEqual(['c.ts'])
    expect(authoredIdentityOffenders([{ path: 'd.ts', source: 'a?.archetype ?? null' }])).toEqual(['d.ts'])
  })

  it('a CSS property is not an identity — the scan reads FIELDS, not style keys', () => {
    expect(authoredIdentityOffenders([
      { path: 'e.tsx', source: 'style={{ background: RED }}' },
      { path: 'f.ts', source: 'const s = { backgroundImage: url, backgroundSize: px }' },
      { path: 'g.ts', source: 'el.style.backgroundColor = c' },
    ])).toEqual([])
  })

  it('names every field it is asked to ban', () => {
    for (const f of AUTHORED_IDENTITY_FIELDS) {
      expect(authoredIdentityOffenders([{ path: 'x.ts', source: `v.${f}` }]), f).toEqual(['x.ts'])
    }
  })
})

describe('the placeholders that presented emptiness as a personality are gone', () => {
  it('neither literal survives anywhere in the viewer', () => {
    expect(REMOVED_PLACEHOLDERS).toEqual(['Their mind is quiet.', 'Still learning everything.'])
    // code only — `becoming.ts` is the one module allowed to name what it deleted
    const all = sourceFiles()
      .filter((f) => !f.path.endsWith('becoming.ts'))
      .map((f) => ({ path: f.path, source: f.source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ') }))
    for (const gone of REMOVED_PLACEHOLDERS) {
      const guilty = all.filter((f) => f.source.includes(gone)).map((f) => f.path)
      expect(guilty, gone).toEqual([])
    }
  })

  it('what replaced them is about the RECORD, not about the person’s inner life', () => {
    for (const line of [THOUGHT_EMPTY, SKILLS_EMPTY, CHANGE_EMPTY]) {
      expect(line, line).not.toMatch(GAMIFICATION_BAN)
      expect(line, line).not.toMatch(/\d/)
      // M6: it says what has not happened YET, never that the world has not begun
      expect(line, line).toMatch(/yet|only just/)
      expect(line, line).not.toMatch(/quiet|still learning|nothing about them is/i)
    }
  })
})

describe('the inspector on a day-0 person makes no claim the run has not earned', () => {
  const a = {
    id: 'amara', name: 'Amara', ageDays: 35 * 364, alive: true, asleep: false, ill: false,
    hp: 100, injuries: [], skills: {}, activity: null, collapsedSinceTick: null,
    needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  }

  const html = renderToStaticMarkup(createElement(InspectorBodyView, {
    agent: a, tick: 0, thought: null, carrying: [], changes: [],
  }))

  it('says the record is empty rather than describing an empty person', () => {
    expect(html).toContain(THOUGHT_EMPTY)
    expect(html).toContain(SKILLS_EMPTY)
    expect(html).toContain(CHANGE_EMPTY)
    for (const gone of REMOVED_PLACEHOLDERS) expect(html).not.toContain(gone)
  })

  // WHAT THE BROWSER CAUGHT: the header badge prints the state and so did the Doing section,
  // so an idle person read "Asleep" twice on one panel.
  it('says what a person is doing exactly once on the panel', () => {
    const withHeader = `<span class="badge">${'Asleep'}</span>${html}`
    expect(withHeader.match(/Asleep/g)?.length).toBe(1)
    const busy = renderToStaticMarkup(createElement(InspectorBodyView, {
      agent: { ...a, activity: { verb: 'build', ticksRemaining: 12 } },
      tick: 0, thought: null, carrying: [], changes: [],
    }))
    expect(busy).toContain('Building — 12 min to go')
    expect(busy.match(/Building/g)?.length).toBe(1)
  })

  it('shows no profile prose and no authored-looking sheet', () => {
    const text = html.replace(/<[^>]*>/g, ' ')
    expect(text).not.toMatch(GAMIFICATION_BAN)
    expect(text).not.toMatch(/\b(trait|background|backstory|archetype|persona|bio|origin)\b/i)
  })

  it('leads with the LATEST document and the most recent edit once there is one', () => {
    const rich = renderToStaticMarkup(createElement(InspectorBodyView, {
      agent: a, tick: 4000, thought: null, carrying: [],
      changes: changeLog([
        { version: 1, day: 0, doc: 'first', edit: 'first written' },
        { version: 2, day: 4, doc: 'second', edit: 'after the flood' },
      ]),
    }))
    expect(rich).toContain('after the flood')
    expect(rich).not.toContain(CHANGE_EMPTY)
    expect(rich.indexOf('after the flood')).toBeLessThan(rich.indexOf('first written'))
  })
})
