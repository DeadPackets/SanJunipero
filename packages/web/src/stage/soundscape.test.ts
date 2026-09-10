import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ViewRect } from '../render/cull.js'
import { heard } from './Soundscape.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
const CODE = src('./Soundscape.tsx')

const FRAME: ViewRect = { x: 0, y: 0, w: 800, h: 400 }
const near = (sx: number, sy: number): number => heard(FRAME, sx, sy).near
const pan = (sx: number): number => heard(FRAME, sx, 200).pan

describe('★ a sound has a place, not a count', () => {
  it('★ is loudest under the lens and falls away from it', () => {
    expect(near(400, 200)).toBe(1)
    expect(near(700, 200)).toBeLessThan(near(500, 200))
    expect(near(500, 200)).toBeLessThan(1)
  })

  // ★ THE BED PUMPED ON EVERY CUT. Fire and murmur were integer counts of what crossed a
  // point-in-rect test, so a camera move stepped the mix by a whole voice.
  it('★ leaves the frame smoothly rather than stepping off it', () => {
    const edge = near(800, 200)
    const past = near(830, 200)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(0.4)
    expect(past).toBeLessThan(edge)
    expect(near(2000, 200)).toBe(0)
  })

  it('★ carries the side of the frame it is on', () => {
    expect(pan(400)).toBe(0)
    expect(pan(800)).toBe(1)
    expect(pan(0)).toBe(-1)
    expect(pan(600)).toBeCloseTo(0.5, 6)
    expect(pan(-4000)).toBe(-1)
  })

  it('takes a frame with no size at all', () => {
    const dead = heard({ x: 0, y: 0, w: 0, h: 0 }, 0, 0)
    expect(Number.isFinite(dead.near)).toBe(true)
    expect(Number.isFinite(dead.pan)).toBe(true)
  })
})

describe('★ the synth hears every snapshot', () => {
  // ★ THE PRINTED CUE STRING WAS THE CHANGE DETECTOR. It is byte-identical from 20:30 to 05:00,
  // so a still night wrote no gain at all and the whole bed landed in one go at dawn.
  it('★ plays the cue list itself, never a string of its gains', () => {
    expect(CODE).toMatch(/synth\.current\?\.play\(cues\)/)
    expect(CODE).toMatch(/\}, \[cues\]\)/)
    expect(CODE).not.toMatch(/toFixed\(3\)/)
  })

  it('★ stamps a chip off the roll call of voices, not off their gains', () => {
    expect(CODE).toMatch(/const named = cues\.map\(\(c\) => c\.source\)\.join/)
    expect(CODE).toMatch(/\}, \[named\]\)/)
  })

  // ★ A TOWN LEFT ON A TAB kept synthesising forever at whatever the mix was when it went away.
  it('★ hands the tab going away to the synth', () => {
    expect(CODE).toMatch(/visibilitychange/)
    expect(CODE).toMatch(/setHidden\(document\.hidden\)/)
  })

  it('★ rings only for a bell the viewer can see ring', () => {
    const block = /law_ratified[\s\S]*?\n {6}\}\),/.exec(CODE)?.[0] ?? ''
    expect(block).not.toBe('')
    expect(block).toMatch(/inView\(/)
    expect(block).toMatch(/agentId/)
  })

  it('★ hangs how loud off the note itself', () => {
    expect(CODE).toMatch(/type="range"/)
    expect(CODE).toMatch(/rememberStoredLevel/)
    expect(CODE).toMatch(/masterFor\(level, minuteOfDay\)/)
  })

  // The firefly layer already caches this list against the terrain; keying it on `state` meant
  // a whole-map scan and sort four times a second that never once hit.
  it('rescans the meadow only when the ground itself changes', () => {
    expect(CODE).toMatch(/\[terrain\]/)
  })
})
