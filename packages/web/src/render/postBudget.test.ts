import { describe, expect, it } from 'vitest'
import {
  DROP_ORDER,
  FRAME_TARGET_MS,
  POST_BUDGET_MS,
  RECOVER_WEIGH_INS,
  type PassSwitches,
  type Rungs,
  applyRungs,
  dropped,
  weigh,
} from './postBudget.js'

const LATE = FRAME_TARGET_MS + POST_BUDGET_MS + 1
/** What a display capped at 60 Hz reports on a machine with every millisecond to spare. */
const VSYNC = FRAME_TARGET_MS
const START: Rungs = { rung: 0, calm: 0 }

const over = (at: Rungs, frameMs: number, times: number): Rungs => {
  let out = at
  for (let i = 0; i < times; i++) out = weigh(out, frameMs)
  return out
}

describe('★ the drop order the chain sheds in', () => {
  it('is depth of attention, then bloom radius, then bloom, then the sun term', () => {
    expect([...DROP_ORDER]).toEqual(['attention', 'bloomRadius', 'bloom', 'sun'])
  })

  it('sheds left to right, one rung at a time', () => {
    expect(dropped(0)).toEqual([])
    expect(dropped(1)).toEqual(['attention'])
    expect(dropped(2)).toEqual(['attention', 'bloomRadius'])
    expect(dropped(3)).toEqual(['attention', 'bloomRadius', 'bloom'])
    expect(dropped(4)).toEqual(['attention', 'bloomRadius', 'bloom', 'sun'])
  })

  it('★ never sheds the grade or the shadows, at any rung or past the end of the ladder', () => {
    for (let rung = 0; rung <= DROP_ORDER.length + 3; rung++) {
      for (const kept of ['grade', 'shadow'])
        expect(dropped(rung), `rung ${String(rung)}`).not.toContain(kept)
    }
    // and they are not droppable because they are not in the ladder, not because it stops short
    for (const kept of ['grade', 'shadow'])
      expect(DROP_ORDER as readonly string[]).not.toContain(kept)
  })
})

describe('★ every rung sheds something, or it is a comment in a list', () => {
  const board = (): { seen: Record<string, boolean[]>; on: PassSwitches } => {
    const seen: Record<string, boolean[]> = {}
    const put =
      (name: string) =>
      (v: boolean): void => {
        ;(seen[name] ??= []).push(v)
      }
    return {
      seen,
      on: {
        attention: put('attention'),
        bloomRadius: put('bloomRadius'),
        bloom: put('bloom'),
        sun: put('sun'),
      },
    }
  }

  it('★ turns a switch for EVERY name in the order, at every rung', () => {
    for (let rung = 0; rung <= DROP_ORDER.length; rung++) {
      const { seen, on } = board()
      applyRungs(rung, on)
      for (const name of DROP_ORDER) expect(seen[name], `rung ${String(rung)}`).toHaveLength(1)
    }
  })

  it('★ sheds exactly the passes the rung says, and takes them back on the way up', () => {
    for (let rung = 0; rung <= DROP_ORDER.length; rung++) {
      const { seen, on } = board()
      applyRungs(rung, on)
      const off = DROP_ORDER.filter((n) => seen[n]![0] === false)
      expect(off, `rung ${String(rung)}`).toEqual(dropped(rung))
    }
  })
})

describe('★ a budget nobody enforces is a comment', () => {
  it('sheds one rung a weigh-in while the frame runs a whole budget long, and stops at the end', () => {
    let at = START
    const went: string[][] = []
    for (let i = 0; i < 6; i++) {
      at = weigh(at, LATE)
      went.push(dropped(at.rung))
    }
    expect(went.map((d) => d.length)).toEqual([1, 2, 3, 4, 4, 4])
    expect(went[3]).toEqual([...DROP_ORDER])
  })

  it('takes the passes back one at a time once the frame has been clear long enough', () => {
    let at = over(START, LATE, 4)
    expect(dropped(at.rung)).toEqual([...DROP_ORDER])
    at = over(at, VSYNC, RECOVER_WEIGH_INS)
    expect(dropped(at.rung)).toEqual(['attention', 'bloomRadius', 'bloom'])
    at = over(at, VSYNC, RECOVER_WEIGH_INS)
    expect(dropped(at.rung)).toEqual(['attention', 'bloomRadius'])
    at = over(at, VSYNC, RECOVER_WEIGH_INS * 2)
    expect(dropped(at.rung)).toEqual([])
  })

  // ★ A 60 Hz display reports 16.7 ms whether the machine has every millisecond to spare or
  // none, so a second threshold UNDER the target is unreachable and a shed pass never returns.
  it('★ recovers on a display capped at exactly its own refresh rate', () => {
    let at = over(START, LATE, 1)
    expect(at.rung).toBe(1)
    at = over(at, VSYNC, RECOVER_WEIGH_INS - 1)
    expect(at.rung, 'one weigh-in short of a recovery').toBe(1)
    at = weigh(at, VSYNC)
    expect(at.rung).toBe(0)
  })

  it('★ a single late frame inside a recovery restarts it rather than nudging the rung back', () => {
    let at = over(START, LATE, 2)
    at = over(at, VSYNC, RECOVER_WEIGH_INS - 1)
    at = weigh(at, LATE)
    expect(at.rung, 'the late frame sheds another').toBe(3)
    at = over(at, VSYNC, RECOVER_WEIGH_INS - 1)
    expect(at.rung, 'and the clock started over').toBe(3)
  })

  it('never climbs past a whole chain, and never below nothing shed', () => {
    expect(over(START, LATE, 40).rung).toBe(DROP_ORDER.length)
    expect(over(START, VSYNC, 100).rung).toBe(0)
  })

  it('states the law at 4.0 ms and reads the frame against 60 Hz', () => {
    expect(POST_BUDGET_MS).toBe(4)
    expect(FRAME_TARGET_MS).toBeCloseTo(16.667, 3)
    expect(weigh(START, FRAME_TARGET_MS + POST_BUDGET_MS).rung, 'exactly at budget holds').toBe(0)
  })
})
