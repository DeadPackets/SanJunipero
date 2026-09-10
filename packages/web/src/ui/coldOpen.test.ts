import { describe, expect, it } from 'vitest'
import { MOTION } from './motion.js'
import { ESTABLISH_HOLD_MS, nextShot, shotKindFor, takeShot, type ShotSpec } from './shot.js'
import {
  COLD_OPEN_FADE_MS,
  COLD_OPEN_IN_MS,
  COLD_OPEN_WAIT_MS,
  coldOpen,
  coldOpenLine,
  firstWorryLine,
  openingShot,
  peopleWords,
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
    expect(open.at(5000, { ...TOWN })).toEqual({ line: null, gone: true, spent: true })
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

// ★ THE COLD OPEN IS A SHOT AS WELL AS A LINE. It shipped as a caption with nothing behind it:
// the browser asked for `opening: false` always, so the establishing shot was unreachable.
describe('★ the shot behind the cold open', () => {
  const TALK = { peak: false, indoors: false, walking: false, cast: 2 }
  const cast: ShotSpec['target'] = { at: 'cast', ids: ['amara', 'yusuf'] }

  it('★ opens the session wide, and asks for it once', () => {
    const open = openingShot()
    expect(shotKindFor({ ...TALK, opening: open(true) })).toBe('establish')
    expect(shotKindFor({ ...TALK, opening: open(true) })).toBe('twoShot')
    expect(shotKindFor({ ...TALK, opening: open(false) })).toBe('twoShot')
  })

  it('★ takes nothing while the cold open is not running, and takes the next one that is', () => {
    const open = openingShot()
    expect(open(false)).toBe(false)
    expect(open(true)).toBe(true)
    expect(open(true)).toBe(false)
  })

  it('★ holds the town wide long enough to be a shot, then hands the grammar back', () => {
    const open = openingShot()
    const shot = takeShot(
      { kind: shotKindFor({ ...TALK, opening: open(true) }), target: { at: 'town' }, why: '' },
      0,
    )
    expect(shot.stop, 'the opening shot is not a wide one').toBe(1)
    expect(shot.minHoldMs).toBe(ESTABLISH_HOLD_MS)
    const after: ShotSpec = {
      kind: shotKindFor({ ...TALK, opening: open(true) }),
      target: cast,
      why: '',
    }
    expect(nextShot(shot, after, ESTABLISH_HOLD_MS - 1), 'it was cut away from').toBe(shot)
    expect(nextShot(shot, after, ESTABLISH_HOLD_MS)?.kind).toBe('twoShot')
  })
})
