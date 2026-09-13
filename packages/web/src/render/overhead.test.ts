import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// The slot is driven for real below, so what it draws is read off the plate it drew.
vi.mock('pixi.js', () => {
  class Point {
    x = 0
    y = 0
    set(x: number, y: number = x): void {
      this.x = x
      this.y = y
    }
  }
  class Container {
    children: Container[] = []
    visible = true
    eventMode = ''
    mask: unknown = null
    destroyed = false
    anchor = new Point()
    position = new Point()
    width = 0
    height = 0
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  class Sprite extends Container {
    texture: unknown = Texture.EMPTY
  }
  class Graphics extends Container {
    fills: number[] = []
    strokes: { width?: number; color?: number }[] = []
    rects: number[][] = []
    clear(): this {
      this.fills = []
      this.strokes = []
      this.rects = []
      return this
    }
    rect(...args: number[]): this {
      this.rects.push(args)
      return this
    }
    fill(o: number | { color?: number }): this {
      this.fills.push(typeof o === 'number' ? o : (o.color ?? 0))
      return this
    }
    stroke(o: { width?: number; color?: number }): this {
      this.strokes.push(o)
      return this
    }
  }
  const Texture = { EMPTY: { empty: true } }
  return { Container, Graphics, Point, Sprite, Texture }
})
import { Container as MockContainer, Texture as MockTexture } from 'pixi.js'
import { EMOTE_KINDS } from './charAnim.js'
import { CONDITIONS, STATES, STATE_WORD, type AgentView } from '../ui/status.js'
import { CARET_LAP_MS } from '../ui/motion.js'
import {
  CARET_SQUARES,
  GLYPH_PX,
  caretLit,
  OVERHEAD_PRIORITY,
  SLOT_ABOVE_HEAD_PX,
  SLOT_PX,
  NO_OVERHEAD,
  createOverhead,
  overheadRow,
} from './overhead.js'

const person = (over: Partial<AgentView> = {}): AgentView => ({
  alive: true,
  asleep: false,
  activity: null,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  ill: false,
  injuries: [],
  collapsedSinceTick: null,
  ...over,
})

const HURT = [{ kind: 'minor', day: 1 }]

describe('★ 7A — one slot, one glyph, and the priority table is the whole spec', () => {
  it('shows nothing at all for a person between things', () => {
    expect(overheadRow(person())).toBeNull()
    // ...which is the state whose word is fixed, and it is not "Idle"
    expect(STATE_WORD.idle).toBe('Between things')
  })

  it('never shows two at once, whatever is true of a person', () => {
    const busy = person({
      asleep: true,
      injuries: HURT,
      ill: true,
      needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    })
    const row = overheadRow(busy)
    expect(row).not.toBeNull()
    expect(OVERHEAD_PRIORITY.filter((r) => r.id === row?.id)).toHaveLength(1)
  })

  it('★ takes the news first: hurt outranks asleep, and collapse outranks hurt', () => {
    expect(overheadRow(person({ injuries: HURT, asleep: true }))?.id).toBe('hurt')
    expect(overheadRow(person({ injuries: HURT, collapsedSinceTick: 4 }))?.id).toBe('collapsed')
    expect(overheadRow(person({ asleep: true }))?.id).toBe('asleep')
  })

  // ★ The case one slot alone could not draw: the act chip under their feet still says the job.
  it('★ shows HURT over a person who is chopping — the chip says they are still at work', () => {
    const chopping = person({ activity: { verb: 'chop' }, injuries: HURT })
    expect(overheadRow(chopping)?.id).toBe('hurt')
    expect(overheadRow(chopping)?.urgent).toBe(true)
  })

  // No hammer exists in the emote atlas, and none is needed: the chip under the feet is the
  // mark, so a working person with nothing wrong wears nothing over their head.
  it('★ leaves a working person’s slot empty — the chip is their mark', () => {
    expect(overheadRow(person({ activity: { verb: 'chop' } }))).toBeNull()
    expect(OVERHEAD_PRIORITY.some((r) => r.id === 'working')).toBe(false)
    expect(OVERHEAD_PRIORITY.some((r) => r.id === 'walking')).toBe(false)
    expect(OVERHEAD_PRIORITY.some((r) => r.id === 'idle')).toBe(false)
  })

  it('leaves the dead unmarked — the renderer’s tone owns that, not a chip', () => {
    expect(overheadRow(person({ alive: false, injuries: HURT }))).toBeNull()
  })

  it('asks the atlas for a glyph it actually has, on every row', () => {
    for (const row of OVERHEAD_PRIORITY) expect(EMOTE_KINDS, row.id).toContain(row.glyph)
  })

  // ★ A checkerboard stood over a talker's head in the shipped watch. The cut took
  // `EMOTE_KINDS.indexOf(kind)` at face value, and -1 for a kind the sheet has no cell for cut a
  // frame off the left of the atlas — art the viewer reads as "the picture is missing", drawn
  // over a person who was only speaking.
  // The index that produced it is checked one test up: every row's glyph is in the roster, so
  // no reachable row asks the atlas for a cell it has not got.
  it('★ a cell the atlas does not have draws NOTHING, never a placeholder', () => {
    const slot = createOverhead(new MockContainer())
    slot.setRow(OVERHEAD_PRIORITY[0]!)
    expect(slot.glyph.texture, 'nothing was cut for it').toBe(MockTexture.EMPTY)
    expect(slot.glyph.visible, 'so the slot shows no mark at all').toBe(false)

    slot.glyph.texture = { frame: { x: 0 } } as never
    slot.setRow(OVERHEAD_PRIORITY[1]!)
    expect(slot.glyph.visible, 'and a cut cell IS drawn').toBe(true)
  })

  // The web and the forge each keep the roster; drift shifts every cell by one and the whole
  // town wears the wrong glyph — the same failure, arriving quietly. Read off the forge's source
  // rather than imported: `@sj/forge` reaches sharp and better-sqlite3, and the viewer must not.
  it('★ cuts from the same roster the atlas is drawn from', () => {
    const forge = readFileSync(new URL('../../../forge/src/emotes.ts', import.meta.url), 'utf8')
    const roster = /export const EMOTE_KINDS = \[([\s\S]*?)\] as const/.exec(forge)?.[1] ?? ''
    expect(roster, "the forge's roster must be findable").not.toBe('')
    expect([...roster.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...EMOTE_KINDS])
  })

  // ★ A transcription drifts; this makes every future word declare itself. Add a condition to
  // `status.ts` and it reaches the roster and the plate — this is what stops it reaching the
  // head by accident, or silently not reaching it at all.
  it('★ accounts for every word status.ts can produce — a row, or a named omission', () => {
    const spoken = new Set(OVERHEAD_PRIORITY.map((r) => r.id))
    for (const word of [...STATES, ...CONDITIONS]) {
      expect(
        spoken.has(word) || NO_OVERHEAD.includes(word),
        `${word} is neither a row nor a named omission`,
      ).toBe(true)
    }
    // ...and nothing is on both lists
    for (const word of NO_OVERHEAD) expect(spoken.has(word), word).toBe(false)
  })

  it('marks exactly the rows that are news as urgent', () => {
    expect(OVERHEAD_PRIORITY.filter((r) => r.urgent).map((r) => r.id)).toEqual([
      'collapsed',
      'hurt',
      'unwell',
    ])
  })
})

// ★ An arch of progress over the head read as broken on any job past a minute, and crowded the
// one address the slot was built to be. `acts.ts` carries progress now.
describe('★ the slot is one glyph, and nothing else stands over a head', () => {
  const slot = (row = OVERHEAD_PRIORITY[0]!) => {
    const parent = new MockContainer()
    const o = createOverhead(parent)
    o.setRow(row)
    return { parent, o, node: o.node as unknown as Drawn }
  }
  type Drawn = { mask: unknown; children: Drawn[]; fills: number[]; visible: boolean }
  const walk = (n: Drawn): Drawn[] => [n, ...n.children.flatMap(walk)]

  it('sits eight pixels above the head, where 7A puts it', () => {
    expect(SLOT_ABOVE_HEAD_PX).toBe(8)
    expect(SLOT_PX).toBe(20)
    expect(GLYPH_PX).toBeLessThan(SLOT_PX)
  })

  it('★ draws one plate, one glyph and a caret nobody wears by default', () => {
    const { o, node } = slot()
    // The third is the thinking caret. It counts nothing about the world: no job, no denominator,
    // no progress, and it is dark until the shot is about the body under it.
    expect(node.children, 'the plate, the mark and the caret').toHaveLength(3)
    expect(node.children[2]!.visible, 'and it starts dark').toBe(false)
    for (const row of OVERHEAD_PRIORITY) o.setRow(row)
    expect(node.children, 'and no news ever adds a fourth thing').toHaveLength(3)
    expect(node.children[2]!.visible, 'and no news lights the caret').toBe(false)
  })

  // With chips on everyone in the viewport, a mask per chip is a render target per person.
  // With chips on everyone in the viewport, a mask per chip is a render target per person.
  // The act chip's own half is driven in actsLayer.test.ts, '★ carries no mask of its own'.
  it('★ draws the mark unmasked', () => {
    const { o, node } = slot()
    for (const row of OVERHEAD_PRIORITY) o.setRow(row)
    for (const n of walk(node)) expect(n.mask).toBeNull()
  })

  it('gives the mark its own ground, like everything else over this town', () => {
    const plate = (row: (typeof OVERHEAD_PRIORITY)[number]): Drawn => slot(row).node.children[0]!
    const urgent = plate(OVERHEAD_PRIORITY.find((r) => r.urgent)!)
    const quiet = plate(OVERHEAD_PRIORITY.find((r) => !r.urgent)!)
    // a stepped ledge under the mark: an ink slab, then the paper over it
    expect(urgent.fills).toHaveLength(2)
    expect(urgent.fills[1], 'news wears the ember plate').toBe(0xe8785a)
    expect(quiet.fills[1]).not.toBe(urgent.fills[1])
    expect(quiet.fills[0], 'and both stand on the same ink').toBe(urgent.fills[0])
  })
})

// ★ THE CARET: the one mark that says a mind is in flight, and the reason it is not a spinner.
// A turn takes 10 to 90 seconds, so a lit dot on every head most of the time is wallpaper.
describe('★ the thinking caret', () => {
  it('fills left to right, one square per third of a lap, and starts over', () => {
    const at = (ms: number) => caretLit(0, ms, true)
    expect([at(0), at(299), at(300), at(599), at(600), at(899)]).toEqual([1, 1, 2, 2, 3, 3])
    expect(at(CARET_LAP_MS)).toBe(1)
    expect(at(CARET_LAP_MS * 3 + 450)).toBe(2)
  })

  it('★ lights all three and stops for a viewer who asked for stillness', () => {
    for (const ms of [0, 200, 500, 880]) expect(caretLit(0, ms, false)).toBe(CARET_SQUARES)
  })

  it('draws its own ground and one square per lit step, and puts itself away at zero', () => {
    const o = createOverhead(new MockContainer())
    const caret = o.node.children[2] as unknown as {
      visible: boolean
      rects: number[][]
      fills: number[]
    }
    o.setCaret(1)
    expect(caret.visible).toBe(true)
    expect(caret.rects, 'the slab plus one square').toHaveLength(2)
    o.setCaret(CARET_SQUARES)
    expect(caret.rects).toHaveLength(1 + CARET_SQUARES)
    // the slab's paper, then the squares' one ink: the mark never floats on the world's own art
    expect(caret.fills).toHaveLength(2)
    o.setCaret(0)
    expect(caret.visible).toBe(false)
  })

  it('redraws only when the count moves, because this runs every frame for every body', () => {
    const o = createOverhead(new MockContainer())
    const caret = o.node.children[2] as unknown as { rects: number[][] }
    o.setCaret(2)
    const drawn = caret.rects.length
    o.setCaret(2)
    o.setCaret(2)
    expect(caret.rects).toHaveLength(drawn)
  })
})
