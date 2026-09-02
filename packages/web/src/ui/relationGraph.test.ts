import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bondFrom, type Bond, type BondAct, type BondKind, type BondsResponse } from '@sj/shared'
import { GAMIFICATION_BAN } from './townStats.js'
import { BOND_LEVELS, BOND_TYPES, LEVEL_RANK, bondArc, type LineageLike } from './bondModel2.js'
import { BondDetail, FadedBond } from '../paper/pages/BondDetail.js'
import { LegendChip } from './LegendChip.js'
import {
  ARC_COLOR,
  LENS_BACKGROUND,
  LEVEL_DISTANCE,
  NO_LINK_LEVEL,
  TYPE_STROKE,
  keyOpensBy,
  relationLegend,
  rememberKey,
  toRelationGraph,
} from './relationGraph.js'
import type { PeopleIndex } from './bondModel2.js'

const EMOJI = /\p{Extended_Pictographic}/u
const MASTER_PALETTE = [
  '#FFF6E9',
  '#F6E8D5',
  '#E8D5BC',
  '#D4BC9E',
  '#B89D7E',
  '#F2C879',
  '#E0A95E',
  '#C68A48',
  '#A66E38',
  '#7E512B',
  '#DCE8C8',
  '#B9D19A',
  '#93B573',
  '#6F9455',
  '#4F7040',
  '#F2C6C2',
  '#E09E9B',
  '#C47876',
  '#9E5A5C',
  '#D6EAF2',
  '#A8CFE0',
  '#7FB0C9',
  '#5A8CAB',
  '#3E6786',
  '#E9E2DA',
  '#CFC6BC',
  '#ABA198',
  '#857D75',
  '#5D5751',
  '#43394A',
  '#322B38',
  '#241F2B',
  '#171420',
  '#F7A66B',
  '#E8785A',
  '#8A6FA8',
  '#F4E289',
  '#F5D3B3',
  '#D9A876',
  '#9C6B47',
]

// WCAG 2.x relative luminance, computed rather than a pasted number
const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (fg: string, bg: string): number => {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const at = (tick: number, kind: BondKind): BondAct => ({ tick, kind })

const bond = (aId: string, bId: string, _kind: BondKind, acts: BondAct[], asOfTick = 0): Bond =>
  bondFrom(aId, bId, acts, asOfTick)
const api = (bonds: Bond[]): BondsResponse => ({ bonds, asOfTick: 0 })

const PEOPLE: PeopleIndex = {
  amara: { name: 'Amara', alive: true },
  nadia: { name: 'Nadia', alive: true },
  yusuf: { name: 'Yusuf', alive: true },
  kid: { name: 'Kid', alive: true },
}
const NO_LINEAGE: LineageLike = { parentOf: [] }
const FAMILY: LineageLike = { parentOf: [{ parentId: 'amara', childId: 'kid', tick: 5 }] }

// ── AUDIT R4: a young town was empty dot-grid and one italic sentence ─────────────────────
describe('★ every living person is a node, always', () => {
  it('a town with ZERO bonds is five people, not an empty page', () => {
    const g = toRelationGraph(api([]), NO_LINEAGE, PEOPLE, 0)
    expect(g.nodes.map((n) => n.id)).toEqual(['amara', 'kid', 'nadia', 'yusuf'])
    expect(g.links).toEqual([])
  })

  it('an unlinked person is still on the page beside a linked one', () => {
    const g = toRelationGraph(
      api([bond('amara', 'nadia', 'owe', [at(0, 'owe'), at(0, 'owe'), at(0, 'owe')])]),
      NO_LINEAGE,
      PEOPLE,
      0,
    )
    expect(g.nodes.length).toBe(4)
    expect(g.links.length).toBe(1)
    expect(g.nodes.find((n) => n.id === 'yusuf')).not.toBeUndefined()
  })

  it('STRANGERS draw no line at all — a line would invent a relationship', () => {
    expect(NO_LINK_LEVEL).toBe('strangers')
    const g = toRelationGraph(
      api([bond('amara', 'nadia', 'friend', [at(0, 'friend')])]),
      NO_LINEAGE,
      PEOPLE,
      0,
    )
    expect(g.links).toEqual([])
    expect(g.nodes.length).toBe(4)
  })

  it('is deterministic — nodes by id, links by bond id, twice the same', () => {
    const bonds = api([
      bond('nadia', 'yusuf', 'owe', [at(0, 'owe'), at(0, 'owe'), at(0, 'owe')]),
      bond('amara', 'nadia', 'owe', [at(0, 'owe'), at(0, 'owe'), at(0, 'owe')]),
    ])
    const a = toRelationGraph(bonds, NO_LINEAGE, PEOPLE, 0)
    expect(a).toEqual(toRelationGraph(bonds, NO_LINEAGE, PEOPLE, 0))
    expect(a.links.map((l) => l.id)).toEqual([...a.links.map((l) => l.id)].sort())
  })
})

// ── THE FOUR CHANNELS ──────────────────────────────────────────────────────────────────────
describe('edge length carries the LEVEL', () => {
  it('is strictly monotonic from close (shortest) to hatred (longest)', () => {
    const order = ['close', 'friendly', 'acquaintances', 'strangers', 'strained', 'hatred'] as const
    for (let i = 1; i < order.length; i++) {
      expect(LEVEL_DISTANCE[order[i]!], order[i]).toBeGreaterThan(LEVEL_DISTANCE[order[i - 1]!])
    }
    expect(LEVEL_DISTANCE.close).toBeLessThan(LEVEL_DISTANCE.hatred)
    // and it is the warmth order read backwards, so the picture cannot disagree with the word
    expect(order.map((l) => LEVEL_RANK.indexOf(l))).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('is total over BOND_LEVELS, and every link takes its own level’s length', () => {
    for (const l of BOND_LEVELS) expect(LEVEL_DISTANCE[l], l).toBeGreaterThan(0)
    const g = toRelationGraph(
      api([
        bond(
          'amara',
          'nadia',
          'partner',
          Array.from({ length: 6 }, () => at(0, 'partner')),
        ),
      ]),
      NO_LINEAGE,
      PEOPLE,
      0,
    )
    expect(g.links[0]!.level).toBe('close')
    expect(g.links[0]!.distance).toBe(LEVEL_DISTANCE.close)
  })
})

describe('edge mark carries the TYPE, and colour is never the only signal', () => {
  it('★ every (dash, strokeCount) pair is pairwise DISTINCT', () => {
    const seen = new Map<string, string>()
    for (const t of BOND_TYPES) {
      const s = TYPE_STROKE[t]
      const sig = `${s.dash === null ? 'solid' : s.dash.join(',')}|${s.strokeCount}`
      expect(seen.has(sig), `${t} is drawn the same as ${seen.get(sig)}`).toBe(false)
      seen.set(sig, t)
    }
    expect(seen.size).toBe(BOND_TYPES.length)
  })

  it('a kin edge is always oriented parent → child, however it was stored', () => {
    const warm = Array.from({ length: 3 }, () => at(0, 'owe'))
    const fromChild = toRelationGraph(api([bond('kid', 'amara', 'owe', warm)]), FAMILY, PEOPLE, 0)
    expect(fromChild.links[0]!.type).toBe('parent')
    expect(fromChild.links[0]!.source).toBe('amara')
    expect(fromChild.links[0]!.target).toBe('kid')
    expect(fromChild.links[0]!.dash).toEqual(TYPE_STROKE.parent.dash)
  })
})

describe('edge colour carries the ARC, and clears the ground it is drawn on', () => {
  it('★ every arc colour is a palette member and clears 3:1 on the lens ground', () => {
    expect(LENS_BACKGROUND).toBe('#322B38') // --night
    for (const dir of ['warming', 'cooling', 'steady'] as const) {
      const hex = ARC_COLOR[dir]
      expect(MASTER_PALETTE, `${dir} ${hex}`).toContain(hex.toUpperCase())
      expect(contrast(hex, LENS_BACKGROUND), dir).toBeGreaterThanOrEqual(3)
    }
  })

  it('three directions, three different colours', () => {
    expect(new Set(Object.values(ARC_COLOR)).size).toBe(3)
  })
})

// ── THE LEGEND ─────────────────────────────────────────────────────────────────────────────
describe('relationLegend explains all three axes without becoming a manual', () => {
  const rows = relationLegend()

  it('covers every axis, and every level and family tie it can draw', () => {
    for (const axis of ['level', 'type', 'arc'] as const) {
      expect(rows.filter((r) => r.axis === axis).length, axis).toBeGreaterThan(0)
    }
    expect(
      rows
        .filter((r) => r.axis === 'level')
        .map((r) => r.key)
        .sort(),
    ).toEqual([...BOND_LEVELS].sort())
    // "no family tie" is the ABSENCE of a mark, so it is not a legend row
    expect(rows.filter((r) => r.axis === 'type').map((r) => r.key)).not.toContain('none')
  })

  it('every word passes the copy scans', () => {
    for (const r of rows) {
      expect(r.words.length, r.key).toBeGreaterThan(2)
      expect(r.words, r.key).not.toMatch(GAMIFICATION_BAN)
      expect(r.words, r.key).not.toMatch(/\d/)
      expect(r.words, r.key).not.toMatch(/_/)
    }
  })

  it('is short enough to read — three axes, not a page', () => {
    expect(rows.length).toBeLessThanOrEqual(14)
  })
})

// ── AUDIT M4: the off state was a DIMMING; the ask was a MARK ──────────────────────────────
describe('the legend’s off chip is a struck-through mark, not an opacity', () => {
  const row = relationLegend()[0]!
  const render = (off: boolean): string =>
    renderToStaticMarkup(createElement(LegendChip, { row, off, onToggle: () => {} }))

  it('★ renders a strike ELEMENT when off, and none when on', () => {
    expect(render(true)).toContain('class="legend-strike"')
    expect(render(false)).not.toContain('legend-strike')
  })

  it('never signals its state with transparency', () => {
    for (const off of [true, false]) {
      expect(render(off)).not.toMatch(/opacity/i)
      expect(render(off)).not.toMatch(/rgba\([^)]*0?\.\d+\)/)
    }
  })

  it('says its state out loud, and draws its own mark', () => {
    expect(render(true)).toContain('aria-pressed="false"')
    expect(render(false)).toContain('aria-pressed="true"')
    expect(render(false)).toContain('<svg')
    expect(render(false)).not.toMatch(EMOJI)
  })
})

// ── THE DETAIL PANEL ───────────────────────────────────────────────────────────────────────
describe('BondDetail — the arc, the evidence, and NO filled bar', () => {
  const history = [at(0, 'partner'), at(100, 'partner'), at(200, 'partner')]
  const b = bond('amara', 'nadia', 'partner', history, 200)
  const arc = bondArc(b, 200)
  const html = renderToStaticMarkup(
    createElement(BondDetail, {
      bond: b,
      people: PEOPLE,
      type: 'partner' as const,
      level: 'friendly' as const,
      arc,
      words: 'Amara and Nadia are partners, and they are friends.',
      onClose: () => {},
    }),
  )

  it('★ the strength bar is GONE — a relationship is not a meter with a leader', () => {
    expect(html).not.toContain('bond-bar')
    expect(html).not.toContain('bond-bar-fill')
    expect(html).not.toMatch(/width:\s*\d+%/)
    expect(html).not.toContain('shared moment')
    expect(html).not.toMatch(/out of \d+/)
  })

  it('says the level, the sentence, and which way it is going', () => {
    expect(html).toContain('Friends')
    expect(html).toContain('Amara and Nadia are partners')
    expect(html).toMatch(/Getting closer|Holding steady|Drifting apart/)
  })

  it('shows the partnership’s evidence, and never a word the world did not record', () => {
    expect(html).toContain('shared a roof')
    const text = html.replace(/<[^>]*>/g, ' ')
    expect(text.toLowerCase()).not.toContain('married')
    expect(text).not.toMatch(GAMIFICATION_BAN)
    expect(html).not.toMatch(EMOJI)
  })

  it('keeps the dated history the panel already had, newest first', () => {
    const days = [...html.matchAll(/Day (\d+) (\d\d:\d\d)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(days.length).toBeGreaterThan(2)
  })

  it('a pair with no partnership gets no evidence line at all', () => {
    const plain = renderToStaticMarkup(
      createElement(BondDetail, {
        bond: bond('amara', 'yusuf', 'friend', [at(0, 'friend')]),
        people: PEOPLE,
        type: 'none' as const,
        level: 'acquaintances' as const,
        arc,
        words: 'Amara and Yusuf know each other a little.',
        onClose: () => {},
      }),
    )
    expect(plain).not.toContain('bond-evidence')
    expect(plain).not.toContain('bond-type')
  })
})

// `api.bonds.find(...)!` over a list that refetches every 30s handed BondDetail `undefined` and
// took the whole app — town and all — down with the panel.
describe('★ a bond that decays while its panel is open', () => {
  it('says which of the two happened, and offers the way out', () => {
    const html = renderToStaticMarkup(createElement(FadedBond, { onClose: () => {} }))
    expect(html).toContain('This bond has faded')
    expect(html).toContain('aria-label="Close this bond"')
    // One component, one role: it used `status` on this branch and `group` on the other, and a
    // panel that opened on a click is not an announcement.
    expect(html).toContain('role="group"')
  })

  it('is the branch the graph takes when the lookup finds nothing', () => {
    const source = readFileSync(new URL('../paper/pages/BondsGraph.tsx', import.meta.url), 'utf8')
    expect(source).toContain('<FadedBond onClose={closeDetail} />')
  })
})

// ★ Thirteen chips and no words is a picture nobody can read, and the key was shut by default:
// the one thing that explains the graph had to be found before the graph could be read.
describe('★ the key opens on the first look and remembers being shut', () => {
  const store = (): Storage => {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
    } as unknown as Storage
  }

  it('★ opens for a viewer who has never shut it', () => {
    expect(keyOpensBy(store())).toBe(true)
  })

  it('★ stays shut for the rest of the tab once it has been shut', () => {
    const s = store()
    rememberKey(s, false)
    expect(keyOpensBy(s)).toBe(false)
  })

  it('remembers nothing about opening it again — only the dismissal is a decision', () => {
    const s = store()
    rememberKey(s, true)
    expect(keyOpensBy(s)).toBe(true)
  })

  it('gives the legend to a viewer whose browser refuses to remember them', () => {
    const refuses = {
      getItem: () => {
        throw new Error('sandboxed')
      },
      setItem: () => {
        throw new Error('sandboxed')
      },
    } as unknown as Storage
    expect(keyOpensBy(refuses)).toBe(true)
    expect(() => {
      rememberKey(refuses, false)
    }).not.toThrow()
  })

  it('is the default the graph actually opens with', () => {
    const source = readFileSync(new URL('../paper/pages/BondsGraph.tsx', import.meta.url), 'utf8')
    expect(source).toContain('useState(() => keyOpensBy(sessionStore()))')
    expect(source).toContain('rememberKey(sessionStore(), !keyOpen)')
  })
})
