import { describe, expect, it } from 'vitest'
import { MOTION } from './motion.js'
import {
  COLD_OPEN_FADE_MS,
  COLD_OPEN_IN_MS,
  COLD_OPEN_STRIP_MS,
  COLD_OPEN_WAIT_MS,
  coldOpen,
  coldOpenLine,
  firstWorryLine,
  peopleWords,
  stripReady,
} from './coldOpen.js'

// Every case here drives the real sequence over a clock the test hands it. Nothing reads the
// source of this file, and nothing waits on a real timer.
const TOWN = { dressed: true, living: 6 }

describe('★ the cold open', () => {
  it('★ says nothing until the town is DRESSED, however long the scene has existed', () => {
    const open = coldOpen(0)
    for (const t of [0, 100, 900, 2999])
      expect(open.at(t, { dressed: false, living: 6 }).line, `at ${String(t)}ms`).toBe(null)
    // ...and the moment art is in hand the sequence starts, a beat before the line lands
    expect(open.at(3000 - 1, { ...TOWN }).line).toBe(null)
    expect(open.at(3000 - 1 + COLD_OPEN_IN_MS, { ...TOWN }).line).toBe(
      'Six people live here. Nobody wrote what they do next.',
    )
  })

  it('★ counts the living bodies the world holds, never a number of its own', () => {
    expect(coldOpenLine(6)).toBe('Six people live here. Nobody wrote what they do next.')
    expect(coldOpenLine(22)).toBe('22 people live here. Nobody wrote what they do next.')
    expect(peopleWords(1)).toBe('One person')
    expect(peopleWords(20)).toBe('Twenty people')
    // past the words the figure is honest rather than wrong
    expect(peopleWords(24)).toBe('24 people')
    const open = coldOpen(0)
    open.at(0, { dressed: true, living: 3 })
    expect(open.at(COLD_OPEN_IN_MS, { dressed: true, living: 3 }).line).toBe(
      'Three people live here. Nobody wrote what they do next.',
    )
  })

  it('★ never opens over an empty town, whatever the art did', () => {
    const open = coldOpen(0)
    for (const t of [0, COLD_OPEN_WAIT_MS, COLD_OPEN_WAIT_MS + COLD_OPEN_IN_MS])
      expect(open.at(t, { dressed: true, living: 0 }).line).toBe(null)
    // the town arrives late and the sequence still runs
    expect(open.at(9000, { ...TOWN }).line).toBe(null)
    expect(open.at(9000 + COLD_OPEN_IN_MS, { ...TOWN }).line).not.toBe(null)
  })

  it('★ reveals anyway when the art never lands, so a slow codex cannot hold the frame', () => {
    const open = coldOpen(0)
    expect(open.at(COLD_OPEN_WAIT_MS - 1, { dressed: false, living: 6 }).line).toBe(null)
    expect(open.at(COLD_OPEN_WAIT_MS, { dressed: false, living: 6 }).line).toBe(null)
    expect(open.at(COLD_OPEN_WAIT_MS + COLD_OPEN_IN_MS, { dressed: false, living: 6 }).line).toBe(
      'Six people live here. Nobody wrote what they do next.',
    )
  })

  // The seconds are the sequence a viewer watches, so they are written out here rather than
  // read back off the module: a constant this test took from the source could not be wrong.
  it('★ lands the line at 0.4 s, clears it at 12 s, and never brings it back this session', () => {
    const open = coldOpen(0)
    expect(open.at(0, { ...TOWN }).line, 'the town arrives, the line waits a beat').toBe(null)
    expect(open.at(399, { ...TOWN }).line).toBe(null)
    expect(open.at(400, { ...TOWN }).line).toBe(
      'Six people live here. Nobody wrote what they do next.',
    )
    expect(open.at(11_999, { ...TOWN })).toMatchObject({ gone: false, spent: false })
    expect(open.at(12_000, { ...TOWN }).gone, 'the line is on its way out').toBe(true)
    expect(open.at(12_000 + COLD_OPEN_FADE_MS, { ...TOWN })).toEqual({
      line: null,
      gone: true,
      spent: true,
      sinceMs: 12_000 + COLD_OPEN_FADE_MS,
    })
    for (const t of [12_400, 20_000, 3_600_000])
      expect(open.at(t, { ...TOWN }).line, `at ${String(t)}ms`).toBe(null)
  })

  // ★ The fade is the sheet's own scene motion, so the mark leaves the tree the instant it
  // stops being seen. Both sides are read off the modules on purpose: the tie IS the rule.
  it('★ fades on the world’s own scene motion, never on a number of its own', () => {
    expect(COLD_OPEN_FADE_MS).toBe(MOTION.scene.ms)
  })

  it('★ goes early when the first cut or a hand on the camera arrives', () => {
    const open = coldOpen(0)
    open.at(0, { ...TOWN })
    expect(open.at(COLD_OPEN_IN_MS, { ...TOWN }).line).not.toBe(null)
    open.dismiss(2000)
    expect(open.at(2000, { ...TOWN }).gone).toBe(true)
    expect(open.at(2000 + COLD_OPEN_FADE_MS, { ...TOWN }).spent).toBe(true)
  })

  it('★ a hand on the camera before the town arrives cancels the whole sequence', () => {
    const open = coldOpen(0)
    open.dismiss(50)
    expect(open.at(5000, { ...TOWN })).toEqual({
      line: null,
      gone: true,
      spent: true,
      sinceMs: COLD_OPEN_STRIP_MS,
    })
  })

  // ★ The premise gets the first three seconds alone. The strip comes up on the plan's own beat,
  // and a sequence that never ran or is already over holds nothing back.
  it('★ lets the foot strip in at 3 s, and never holds it once the open is over', () => {
    const open = coldOpen(0)
    expect(stripReady(open.at(0, { ...TOWN }))).toBe(false)
    expect(stripReady(open.at(COLD_OPEN_STRIP_MS - 1, { ...TOWN }))).toBe(false)
    expect(stripReady(open.at(COLD_OPEN_STRIP_MS, { ...TOWN }))).toBe(true)
    expect(stripReady(open.at(20_000, { ...TOWN }))).toBe(true)
    const skipped = coldOpen(0)
    skipped.dismiss(50)
    expect(stripReady(skipped.at(60, { ...TOWN }))).toBe(true)
    // No town at all is no strip: there is nothing for it to say and nothing to stand over.
    expect(stripReady(coldOpen(0).at(0, { dressed: true, living: 0 }))).toBe(false)
  })

  // The second line is a person, not a count: the one thing a first page owes a reader.
  it('★ names one person and what is on their mind, by the day, in their card’s own words', () => {
    const aims = [
      { agentId: 'amara', worry: null },
      { agentId: 'farida', worry: 'Bashir gives away what the two of them will need by winter.' },
      { agentId: 'tariq', worry: "being Kamal's boy for the rest of his life" },
    ]
    const names: Record<string, string> = { farida: 'Farida', tariq: 'Tariq' }
    const nameOf = (id: string): string | undefined => names[id]
    expect(firstWorryLine(aims, nameOf, 0)).toBe(
      'On Farida’s mind: Bashir gives away what the two of them will need by winter.',
    )
    expect(firstWorryLine(aims, nameOf, 1)).toBe(
      "On Tariq’s mind: being Kamal's boy for the rest of his life.",
    )
    expect(firstWorryLine(aims, nameOf, 2)).toBe(firstWorryLine(aims, nameOf, 0))
    expect(firstWorryLine([{ agentId: 'amara', worry: null }], nameOf, 0)).toBe(null)
  })
})

// ★ THE SHOT BEHIND THE COLD OPEN moved into the tree: `openingShot` was asked in a render
// body, so a render React threw away could spend the session's one opening. `DirectorMode` now
// spends it on the shot a viewer got, and `openingShot.test.ts` drives that. The grammar it used
// to assert here is driven in `shot.test.ts` (the establish stop at :66, its floor at :111).
