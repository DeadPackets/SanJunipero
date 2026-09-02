import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EMOTE_KINDS } from './charAnim.js'
import { CONDITIONS, STATES, STATE_WORD, type AgentView } from '../ui/status.js'
import {
  GLYPH_PX,
  OVERHEAD_PRIORITY,
  SLOT_ABOVE_HEAD_PX,
  SLOT_PX,
  NO_OVERHEAD,
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
  it('★ a cell the atlas does not have draws NOTHING, never a placeholder', () => {
    const SRC = readFileSync(new URL('./characters.ts', import.meta.url), 'utf8')
    const cut = /const setGlyph = [\s\S]*?\n  \}/.exec(SRC)?.[0] ?? ''
    expect(cut, 'setGlyph must be findable').not.toBe('')
    expect(cut).toContain('Texture.EMPTY')
    // the index is CHECKED before it becomes a frame, rather than handed straight to Rectangle
    expect(cut).toMatch(/cell < 0/)
    expect(cut).not.toMatch(/frame: new Rectangle\(EMOTE_KINDS\.indexOf/)
  })

  // The web and the forge each keep the roster; drift shifts every cell by one and the whole
  // town wears the wrong glyph — the same failure, arriving quietly. Read off the forge's source
  // rather than imported: `@sj/forge` reaches sharp and better-sqlite3, and the viewer must not.
  it('★ cuts from the same roster the atlas is drawn from', () => {
    const forge = readFileSync(
      new URL('../../../forge/src/emotes.ts', import.meta.url),
      'utf8',
    )
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
  const src = readFileSync(new URL('./overhead.ts', import.meta.url), 'utf8')

  it('sits eight pixels above the head, where 7A puts it', () => {
    expect(SLOT_ABOVE_HEAD_PX).toBe(8)
    expect(SLOT_PX).toBe(20)
    expect(GLYPH_PX).toBeLessThan(SLOT_PX)
  })

  it('★ draws one plate and one glyph, and nothing that counts', () => {
    // comments stripped: the source SAYS the blocks are gone where it explains that they are
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/TRACK|BLOCK|blockCentres|trackFilled|setTrack/)
    expect(code).toContain('node.addChild(plate, glyph)')
  })

  // With chips on everyone in the viewport, a mask per chip is a render target per person.
  it('★ draws the mark unmasked', () => {
    expect(src).not.toContain('.mask')
    expect(readFileSync(new URL('./acts.ts', import.meta.url), 'utf8')).not.toContain('.mask')
  })

  it('gives the mark its own ground, like everything else over this town', () => {
    expect(src).toContain('brings its own ground')
    expect(src).toMatch(/PLATE_URGENT = 0xe8785a/)
  })
})
