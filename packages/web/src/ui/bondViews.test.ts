import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Bond, BondKind, BondsResponse } from '@sj/shared'
import { EMPTY_LINEAGE, type PeopleIndex } from './bondModel2.js'
import { LEVEL_DISTANCE, NO_LINK_LEVEL } from './relationGraph.js'
import {
  DRIFT_MIN,
  STRENGTH_FULL,
  STROKE_MAX,
  STROKE_MIN,
  busiestPerson,
  orbitOf,
  orbitRings,
  orbitStroke,
} from './bondOrbit.js'
import { KIND_COLOR } from './relationGraph.js'
import { MATRIX_LEVELS, levelMatrix, shortName } from './bondMatrix.js'
import { BondOrbit } from '../paper/pages/BondOrbit.js'
import { LevelMatrixTable } from '../paper/pages/LevelMatrix.js'

const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8')

const PEOPLE: PeopleIndex = {
  amara: { name: 'Amara', alive: true },
  nadia: { name: 'Nadia', alive: true },
  omar: { name: 'Omar', alive: true },
  salma: { name: 'Salma', alive: true },
}

const bond = (
  aId: string,
  bId: string,
  warmth: number,
  priorWarmth = warmth,
  kind: BondKind = 'friend',
): Bond =>
  ({
    id: `${aId}-${bId}`,
    aId,
    bId,
    kind,
    warmth,
    priorWarmth,
    lastUpdatedTick: 0,
    levelChangedTick: 0,
    acts: [],
  }) as unknown as Bond

// Amara is close to Nadia, knows Omar a little, and has never met Salma.
const API: BondsResponse = {
  asOfTick: 0,
  bonds: [bond('amara', 'nadia', 40), bond('amara', 'omar', 5), bond('nadia', 'omar', 12)],
}

describe('★ the orbit stands people at their real distance', () => {
  const orbit = orbitOf('amara', API, EMPTY_LINEAGE, PEOPLE, 0)!

  it('★ takes its rings straight off the graph’s own LEVEL_DISTANCE table', () => {
    for (const ring of orbit.rings) expect(ring.r, ring.level).toBe(LEVEL_DISTANCE[ring.level])
    // ascending, so the picture reads outward as it cools
    const radii = orbit.rings.map((r) => r.r)
    expect(radii).toEqual([...radii].sort((a, b) => a - b))
    expect(orbit.box).toBeGreaterThan(Math.max(...radii))
  })

  // ★ Hatred is 240 and strangers 150, so a town with no cold pair spent 38% of every orbit on
  // two empty bands and crammed the four that matter into the middle.
  it('★ cuts the ladder to the coldest tie the TOWN has, not to the one the ladder could hold', () => {
    expect(orbit.rings.map((r) => r.level)).toEqual([
      'close',
      'friendly',
      'acquaintances',
      'strangers',
    ])
    expect(orbit.box).toBe(LEVEL_DISTANCE.strangers + 26)

    // ...and a town with a cold pair in it draws down to that pair's own ring
    const cold = { asOfTick: 0, bonds: [...API.bonds, bond('omar', 'yusuf', -20)] }
    const wider = orbitOf('amara', cold, EMPTY_LINEAGE, PEOPLE, 0)!
    expect(wider.rings.map((r) => r.level)).toContain('hatred')
    expect(wider.box).toBeGreaterThan(orbit.box)
  })

  // One ladder for the whole town, so two people's orbits are still comparable.
  it('★ draws every orbit in one town to the same ladder', () => {
    const other = orbitOf('salma', API, EMPTY_LINEAGE, PEOPLE, 0)!
    expect(other.box).toBe(orbit.box)
    expect(other.rings).toEqual(orbit.rings)
  })

  it('always leaves a stranger somewhere to stand, however warm the town is', () => {
    expect(orbitRings(0).map((r) => r.level)).toContain('strangers')
  })

  it('puts everybody else on the ring their level names, and nobody anywhere else', () => {
    expect(orbit.ties).toHaveLength(3)
    for (const tie of orbit.ties) expect(tie.r, tie.name).toBe(LEVEL_DISTANCE[tie.level])
    expect(orbit.ties.find((t) => t.id === 'nadia')?.level).toBe('close')
    expect(orbit.ties.find((t) => t.id === 'omar')?.level).toBe('acquaintances')
    expect(orbit.ties.find((t) => t.id === 'salma')?.level).toBe('strangers')
  })

  // The same rule the town graph follows, so the two pictures cannot say different things.
  it('★ draws no line to a stranger — a spoke would invent a relationship', () => {
    expect(orbit.ties.find((t) => t.id === 'salma')?.drawn).toBe(false)
    expect(orbit.ties.find((t) => t.id === 'nadia')?.drawn).toBe(true)
    expect(NO_LINK_LEVEL).toBe('strangers')
  })

  it('★ carries all three detail channels on every spoke', () => {
    for (const tie of orbit.ties) {
      expect(tie.color, tie.name).toMatch(/^#[0-9A-F]{6}$/i) // the arc
      expect([1, 2], tie.name).toContain(tie.strokeCount) // the family tie
      expect(tie.width, tie.name).toBeGreaterThanOrEqual(STROKE_MIN) // how much of it there is
      expect(tie.width, tie.name).toBeLessThanOrEqual(STROKE_MAX)
    }
    // ...and the three are independent: the closest tie is the heaviest one here
    const heaviest = [...orbit.ties].sort((a, b) => b.width - a.width)[0]
    expect(heaviest?.id).toBe('nadia')
  })

  it('spends the whole weight range inside the ties a viewer actually sees', () => {
    expect(orbitStroke(0)).toBe(STROKE_MIN)
    expect(orbitStroke(STRENGTH_FULL)).toBe(STROKE_MAX)
    expect(orbitStroke(STRENGTH_FULL * 10)).toBe(STROKE_MAX)
    expect(orbitStroke(-STRENGTH_FULL)).toBe(STROKE_MAX) // set against is a strong tie too
  })

  it('★ puts the same person in the same place on every visit', () => {
    const again = orbitOf('amara', API, EMPTY_LINEAGE, PEOPLE, 0)!
    expect(again.ties.map((t) => [t.id, t.angle])).toEqual(orbit.ties.map((t) => [t.id, t.angle]))
    // warmest first, so the reader's eye starts where the answer is
    expect(orbit.ties.map((t) => t.id)).toEqual(['nadia', 'omar', 'salma'])
  })

  // ★ THE BEARING IS THE PERSON'S. It came off the warmth sort, so one quarrel swung half the
  // town around the dial: the reader could not watch a tie move because nothing held still.
  it('★ keeps a person on their own bearing when their level changes', () => {
    const cooled: BondsResponse = {
      asOfTick: 0,
      bonds: [bond('amara', 'nadia', -20), bond('amara', 'omar', 5), bond('nadia', 'omar', 12)],
    }
    const after = orbitOf('amara', cooled, EMPTY_LINEAGE, PEOPLE, 0)!
    const bearing = (o: typeof orbit, id: string): number => o.ties.find((t) => t.id === id)!.angle
    for (const id of ['nadia', 'omar', 'salma']) {
      expect(bearing(after, id), id).toBe(bearing(orbit, id))
    }
    // ...and the distance is what moved
    expect(after.ties.find((t) => t.id === 'nadia')!.r).toBeGreaterThan(
      orbit.ties.find((t) => t.id === 'nadia')!.r,
    )
    // every bearing is its own, and they are spread over the whole dial
    expect(new Set(after.ties.map((t) => t.angle)).size).toBe(after.ties.length)
  })

  // ★ SIGNED, never the absolute value: a marriage and a betrayal are not the same shape.
  it('★ carries the arc as a signed number, in and out of the middle', () => {
    const moved: BondsResponse = {
      asOfTick: 0,
      bonds: [
        bond('amara', 'nadia', 40, 10, 'partner'),
        bond('amara', 'omar', 5, 30, 'rival'),
        bond('amara', 'salma', 12, 12, 'work'),
      ],
    }
    const o = orbitOf('amara', moved, EMPTY_LINEAGE, PEOPLE, 0)!
    const of = (id: string) => o.ties.find((t) => t.id === id)!
    expect(of('nadia').drift).toBe(30)
    expect(of('omar').drift).toBe(-25)
    expect(of('salma').drift).toBe(0)
    // and the colour is the kind, so the two channels cannot be read off each other
    expect(of('nadia').color).toBe(KIND_COLOR.partner)
    expect(of('omar').color).toBe(KIND_COLOR.rival)
  })

  it('says nothing at all about somebody the town does not have', () => {
    expect(orbitOf('nobody', API, EMPTY_LINEAGE, PEOPLE, 0)).toBeNull()
  })

  it('opens on the person the town has the most to say about', () => {
    // amara and nadia both have two bonds; the name is the tie-break, so two runs agree
    expect(busiestPerson(PEOPLE, API)).toBe('amara')
    expect(busiestPerson(PEOPLE, { asOfTick: 0, bonds: [] })).toBe('amara')
    expect(busiestPerson({}, API)).toBeNull()
  })
})

describe('★ the matrix gives every pair one address', () => {
  const m = levelMatrix(API, EMPTY_LINEAGE, PEOPLE, 0)

  it('is square, in one stable order, with the diagonal marked as itself', () => {
    expect(m.heads.map((h) => h.name)).toEqual(['Amara', 'Nadia', 'Omar', 'Salma'])
    for (const row of m.rows) expect(row.cells, row.name).toHaveLength(m.heads.length)
    m.rows.forEach((row, i) => {
      expect(row.cells[i]?.self, row.name).toBe(true)
    })
  })

  it('reads the same both ways round — a pair has one address, not two', () => {
    const at = (a: number, b: number): string => m.rows[a]!.cells[b]!.level
    expect(at(0, 1)).toBe(at(1, 0))
    expect(at(0, 3)).toBe(at(3, 0))
  })

  // ★ The point of the grid: a gap is not missing data.
  it('★ prints a pair the world has no bond for as strangers, and says so', () => {
    const cell = m.rows[0]!.cells[3]! // Amara × Salma
    expect(cell.level).toBe('strangers')
    expect(cell.self).toBe(false)
    expect(cell.words).toContain('strangers')
  })

  it('★ carries the warmth as a number, so the ladder survives without colour', () => {
    expect(m.rows[0]!.cells[1]!.warmth).toBe(40)
    expect(m.rows[0]!.cells[2]!.warmth).toBe(5)
    expect(Number.isInteger(m.rows[0]!.cells[1]!.warmth)).toBe(true)
  })

  it('names every level the ladder has, coldest to warmest', () => {
    expect([...MATRIX_LEVELS]).toEqual([
      'hatred',
      'strained',
      'strangers',
      'acquaintances',
      'friendly',
      'close',
    ])
  })

  it('heads a column with two letters, which is what fits over a cell', () => {
    expect(shortName('Amara')).toBe('Am')
    expect(shortName('A')).toBe('A')
  })
})

describe('★ the two views a reader gets', () => {
  const orbit = orbitOf('amara', API, EMPTY_LINEAGE, PEOPLE, 0)!
  const plot = renderToStaticMarkup(createElement(BondOrbit, { orbit, onCentre: () => undefined }))
  const grid = renderToStaticMarkup(
    createElement(LevelMatrixTable, {
      matrix: levelMatrix(API, EMPTY_LINEAGE, PEOPLE, 0),
      centreId: 'amara',
      onCentre: () => undefined,
    }),
  )

  // ★ WHAT THE ARROWHEAD SAYS, and the one number that says it. Drawn from the sign, so a pair
  // that warmed points at the middle and a pair that cooled points away from it.
  it('★ points the head IN when a pair warmed and OUT when it cooled, and draws none for still', () => {
    const moved: BondsResponse = {
      asOfTick: 0,
      bonds: [
        bond('amara', 'nadia', 40, 10, 'partner'),
        bond('amara', 'omar', 5, 30, 'rival'),
        bond('amara', 'salma', 12, 12, 'work'),
      ],
    }
    const o = orbitOf('amara', moved, EMPTY_LINEAGE, PEOPLE, 0)!
    const drawn = renderToStaticMarkup(
      createElement(BondOrbit, { orbit: o, onCentre: () => undefined }),
    )
    // three alters, one of them steady
    expect(drawn.match(/class="orbit-head"/g)).toHaveLength(2)

    // the head's tip against its own node, on the same spoke
    const heads = [...drawn.matchAll(/points="([^"]+)"/g)].map((m) => m[1]!)
    const tipR = (pts: string): number => {
      const [x, y] = pts.split(' ')[0]!.split(',').map(Number)
      return Math.hypot(x!, y!)
    }
    const warmer = o.ties.find((t) => t.id === 'nadia')!
    const cooler = o.ties.find((t) => t.id === 'omar')!
    const nodeR = (id: string): number => o.ties.find((t) => t.id === id)!.r
    // warming: the tip sits nearer the middle than where the head stands on the spoke
    expect(tipR(heads[0]!)).toBeLessThan(nodeR(warmer.id))
    // cooling: the tip sits further out than where it stands
    expect(tipR(heads[1]!)).toBeGreaterThan(nodeR(cooler.id) * 0.62)
    expect(drawn).toContain('Getting closer.')
    expect(drawn).toContain('Drifting apart.')
  })

  it('★ says nothing at all about a pair that has not moved by as much as one act', () => {
    const barely: BondsResponse = {
      asOfTick: 0,
      bonds: [bond('amara', 'nadia', 40, 40 - DRIFT_MIN / 2, 'partner')],
    }
    const o = orbitOf('amara', barely, EMPTY_LINEAGE, PEOPLE, 0)!
    const drawn = renderToStaticMarkup(
      createElement(BondOrbit, { orbit: o, onCentre: () => undefined }),
    )
    expect(drawn).not.toContain('orbit-head')
    expect(drawn).not.toContain('Getting closer.')
  })

  it('draws a ring for every level in use and a spoke only where there is a tie', () => {
    expect(plot.match(/class="orbit-ring"/g)).toHaveLength(orbit.rings.length)
    // three alters, two of them met: Salma gets a node and no line
    expect(plot.match(/<line /g)).toHaveLength(2)
    // the ties, not the person in the middle
    expect(plot.match(/class="orbit-mark(?: above)?"/g)).toHaveLength(3)
  })

  // The ring radii are layout, in pixels. Printed beside the word they read as a score.
  it('★ says what each ring means and never how wide it is', () => {
    const key = /<p class="orbit-key">([\s\S]*?)<\/p>/.exec(plot)?.[1] ?? ''
    expect(key).toContain('close')
    expect(key.replace(/<[^>]*>/g, ' ')).not.toMatch(/\d/)
  })

  it('★ names the picture for a reader who cannot see it, and gives them a way through it', () => {
    expect(plot).toContain('role="img"')
    expect(plot).toContain('nearer meaning closer')
    expect(plot).toMatch(/aria-label="Everyone Amara knows"/)
    expect(plot.match(/<button/g)).toHaveLength(orbit.ties.length)
    expect(plot).toContain('Open Nadia’s orbit.')
  })

  // Nothing in this product renders below twelve, and an SVG glyph would be 10px on a phone.
  it('★ sets the orbit names in HTML at the sheet’s own scale, never inside the viewBox', () => {
    expect(plot).not.toMatch(/<text/)
    expect(/\n\.orbit-name \{([^}]*)\}/.exec(CSS)?.[1]).toContain('font-size: var(--f-2)')
  })

  it('★ is a real table, with a row a keyboard can choose a person from', () => {
    expect(grid).toContain('<caption')
    expect(grid.match(/scope="col"/g)).toHaveLength(5) // the corner plus four people
    expect(grid.match(/scope="row"/g)).toHaveLength(4)
    expect(grid).toMatch(/aria-pressed="true"[^>]*>Amara</)
    expect(grid).toContain('class="matrix-row on"')
  })

  it('★ labels every cell with the sentence the rest of the product uses', () => {
    expect(grid).toMatch(/aria-label="Amara and Salma are strangers to each other\./)
    expect(grid).toContain('data-level="self"')
    expect(grid).toContain('data-level="strangers"')
    expect(grid).toContain('class="matrix-warmth"')
  })

  it('scrolls a wide grid inside its own box rather than the sheet', () => {
    expect(grid).toContain('class="matrix-scroll"')
    expect(/\.matrix-scroll \{([^}]*)\}/.exec(CSS)?.[1]).toContain('overflow-x: auto')
  })

  // A close tie sits above the middle; its name must not land on the person in it.
  it('★ puts a name on the OUTER side of its node', () => {
    expect(plot).toContain('class="orbit-mark above"')
    expect(/\.orbit-mark\.above \.orbit-name[^{]*\{([^}]*)\}/.exec(CSS)?.[1]).toContain('order: -1')
  })

  it('draws a key for every level, so a fill is never asked to speak alone', () => {
    expect(grid.match(/class="matrix-swatch"/g)).toHaveLength(MATRIX_LEVELS.length)
  })
})

describe('★ the tab is one vertical sheet, and the town graph is legible', () => {
  const src = readFileSync(new URL('../paper/pages/BondsGraph.tsx', import.meta.url), 'utf8')

  it('★ stacks the four, and crams nothing side by side', () => {
    expect(src).toContain('className="bonds-sheet"')
    expect(src.match(/className="bonds-section"/g)).toHaveLength(4)
    expect(src.indexOf('bonds-strongest')).toBeLessThan(src.indexOf('<BondOrbit'))
    expect(src.indexOf('<BondOrbit')).toBeLessThan(src.indexOf('<LevelMatrixTable'))
    expect(/\.bonds-sheet \{([^}]*)\}/.exec(CSS)?.[1]).toContain('display: grid')
  })

  // ★ "really hard to see what the connections are" — a 1.5px stone line on a night ground.
  it('★ doubles every edge and draws it on a ground of its own', () => {
    expect(src).toContain('linkCanvasObject={drawLink}')
    expect(src).toMatch(/LINK_WIDTH[^=]*=\s*\{ 1: 3, 2: 5 \}/)
    expect(src).toContain('LINK_CASING_COLOR')
  })

  it('★ puts ink on every side of a name, not one corner of it', () => {
    expect(src).toContain('ctx.strokeText(n.name')
    expect(src).toContain("ctx.lineJoin = 'round'")
    expect(src).toMatch(/const NAME_PX = TEXT_MIN_PX \+ 1/)
  })

  // These run once per link and per node per FRAME; a fresh array each time is tens of
  // thousands a second for a value that never changes.
  it('allocates no dash array inside the draw loops', () => {
    expect(src).not.toMatch(/setLineDash\(\[\]/)
    expect(src).not.toMatch(/\[\.\.\.(l|ring)\.dash\]/)
    expect(src).toContain('const NO_DASH')
  })

  it('★ hands a clicked node to the orbit rather than opening a page', () => {
    expect(src).toMatch(/onNodeClick = useCallback\(\(n: object\) => \{\s*setPicked/)
    expect(src).toContain('Choose anyone above to open their orbit.')
  })

  // ★ The picture that needs a key has failed. There is no key any more, so there must be no
  // control that offers one and no chip that filters the picture down behind the reader's back.
  it('★ carries no legend, no key and no chip that hides an edge', () => {
    expect(src).not.toContain('LegendChip')
    expect(src).not.toContain('How to read this')
    expect(src).not.toContain('bonds-legend')
    expect(src).not.toContain('keyOpensBy')
  })

  // ★ One person's orbit is the answer to "who is this one to everybody else". The field of
  // slabs answers nothing until a reader asks it for the town, so it waits behind its own control.
  it('★ opens with the orbit and keeps the whole town behind a control', () => {
    expect(src.indexOf('<BondOrbit')).toBeLessThan(src.indexOf('bonds-graph'))
    expect(src).toContain('const [townOpen, setTownOpen] = useState(false)')
    expect(src).toContain('Show the town')
    expect(src).toContain('aria-controls="bonds-town"')
  })
})
