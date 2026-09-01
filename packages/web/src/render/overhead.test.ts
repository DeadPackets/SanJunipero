import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZOOM_STOPS } from './camera.js'
import { GLYPH_ZOOM } from './bubbles.js'
import { EMOTE_KINDS } from './charAnim.js'
import { CONDITIONS, STATES, STATE_WORD, type AgentView } from '../ui/status.js'
import {
  BLOCK_PX,
  GLYPH_PX,
  OVERHEAD_PRIORITY,
  SLOT_ABOVE_HEAD_PX,
  SLOT_PX,
  TRACK_BLOCKS,
  TRACK_R,
  TRACK_SPAN_DEG,
  blockCentres,
  NO_OVERHEAD,
  overheadRow,
  trackFilled,
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

  // ★ The case 7A alone could not draw, and the one 7M-B is picked for.
  it('★ shows HURT over a person who is chopping — the track says they are still at work', () => {
    const chopping = person({ activity: { verb: 'chop' }, injuries: HURT })
    expect(overheadRow(chopping)?.id).toBe('hurt')
    expect(overheadRow(chopping)?.urgent).toBe(true)
  })

  // No hammer exists in the emote atlas, and none is needed: while a job runs the track is the
  // mark, so a working person with nothing wrong wears the arc and no glyph.
  it('★ leaves a working person’s slot empty — the track is their mark', () => {
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

describe('★ 7M-B — the track wraps the same slot, only while the job runs', () => {
  it('is seven blocks, so progress is a COUNT before it is ever a hue', () => {
    expect(TRACK_BLOCKS).toBe(7)
    expect(blockCentres()).toHaveLength(TRACK_BLOCKS)
  })

  it('fills whole blocks, from none, and never shows all seven', () => {
    expect(trackFilled(0)).toBe(0)
    expect(trackFilled(0.5)).toBe(3)
    expect(trackFilled(0.99)).toBe(6)
    // the track goes when the act does, so a full arc is never left on screen
    expect(trackFilled(1)).toBe(TRACK_BLOCKS - 1)
    expect(trackFilled(2)).toBe(TRACK_BLOCKS - 1)
    expect(trackFilled(-1)).toBe(0)
  })

  it('never runs backwards as the work goes', () => {
    let prev = -1
    for (let f = 0; f <= 1; f += 0.02) {
      const n = trackFilled(f)
      expect(n, `${f}`).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  it('runs left to right, and peaks over the middle of the slot', () => {
    const at = blockCentres()
    for (let i = 1; i < at.length; i++) expect(at[i]!.x, `${i}`).toBeGreaterThan(at[i - 1]!.x)
    // screen y grows downward, so the top of the arc is the smallest y
    const top = Math.min(...at.map((c) => c.y))
    expect(at[3]!.y).toBe(top)
    expect(at[0]!.x).toBeCloseTo(-at[6]!.x, 6)
  })
})

// ★ THE OWNER'S SIZING NOTE: "make the arc big enough such that the glyph sits under the arc."
describe('★ the arc spans OVER the glyph, and the glyph sits under its curve', () => {
  const at = blockCentres()
  const plateTop = -SLOT_PX / 2
  const blockTop = (c: { y: number }): number => c.y - BLOCK_PX / 2
  const blockBottom = (c: { y: number }): number => c.y + BLOCK_PX / 2

  it('★ leaves every one of the seven blocks clear ABOVE the plate, not crowding it', () => {
    for (const [i, c] of at.entries()) {
      expect(blockBottom(c), `block ${i} sits on the plate`).toBeLessThan(plateTop)
    }
  })

  it('★ arches over the glyph rather than beside it — the span covers the whole slot', () => {
    const widest = Math.max(...at.map((c) => Math.abs(c.x)))
    expect(widest, 'the arc is narrower than the plate it should span').toBeGreaterThan(SLOT_PX / 2)
    // ...and the arc's crown clears the plate by more than the plate is tall, so it reads as a
    // rainbow over the mark and never as a ring squeezing it
    expect(Math.abs(Math.min(...at.map(blockTop)) - plateTop)).toBeGreaterThan(SLOT_PX / 2)
  })

  it('★ holds that clearance at every zoom stop the indicators show at', () => {
    // The slot is world art and scales with the camera, so the RATIO is what has to hold — and
    // a ratio holds at every stop by construction. The floor is the smallest stop that shows.
    const shown = ZOOM_STOPS.filter((z) => z > GLYPH_ZOOM)
    expect(shown.length).toBeGreaterThanOrEqual(2)
    for (const zoom of shown) {
      const gap = (plateTop - Math.max(...at.map(blockBottom))) * zoom
      expect(gap, `zoom ${zoom}`).toBeGreaterThan(0)
    }
  })

  it('states a radius the glyph fits inside, and a span that is an arch and not a circle', () => {
    expect(TRACK_R).toBeGreaterThan(Math.hypot(SLOT_PX / 2, SLOT_PX / 2))
    expect(GLYPH_PX).toBeLessThan(SLOT_PX)
    expect(TRACK_SPAN_DEG).toBeGreaterThan(90)
    expect(TRACK_SPAN_DEG).toBeLessThan(360)
  })

  it('sits eight pixels above the head, where 7A puts it', () => {
    expect(SLOT_ABOVE_HEAD_PX).toBe(8)
    expect(SLOT_PX).toBe(20)
  })
})

describe('the drawing, and the mask that is not there', () => {
  const src = readFileSync(new URL('./overhead.ts', import.meta.url), 'utf8')

  // With chips on everyone in the viewport, a mask per chip is a render target per person.
  it('★ draws the seven blocks unmasked, in one Graphics', () => {
    expect(src).not.toContain('.mask')
    expect(readFileSync(new URL('./acts.ts', import.meta.url), 'utf8')).not.toContain('.mask')
  })

  it('★ tells done from remaining by SHAPE, so no hue is doing the naming', () => {
    // a solid block, and a hollow one drawn as a ring with the ground punched back through it
    expect(src).toMatch(/BLOCK_DONE/)
    expect(src).toMatch(/BLOCK_LEFT/)
    expect(src).toContain('Hollow, not dimmed')
  })

  it('gives the mark its own ground, like everything else over this town', () => {
    expect(src).toContain('brings its own ground')
    expect(src).toMatch(/PLATE_URGENT = 0xe8785a/)
  })
})
