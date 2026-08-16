import { describe, expect, it } from 'vitest'
import type { AgentBody } from '@sj/engine/state'
import type { SimEvent } from '@sj/shared'
import { BOB_PX, EMOTE_KINDS, HIT_AREA_H, HIT_AREA_W, NAME_TAG_MAX_CHARS, WALK_FRAME_MS_V4, WALK_LOOP, charPose, emoteFor, interpolatePos, nameTagText, prunePath } from './charAnim.js'

describe('charPose v4 cadence', () => {
  const v4base = { asleep: false, collapsed: false, walking: true, facing: 'se' as const, nowMs: 0 }
  it('walks the four-frame loop at 180ms per frame', () => {
    const rows = [0, 180, 360, 540].map((nowMs) => charPose({ ...v4base, nowMs }, WALK_FRAME_MS_V4).row)
    expect(rows).toEqual(['contact-a', 'passing-a', 'contact-b', 'passing-b'])
    expect(charPose({ ...v4base, nowMs: 179 }, WALK_FRAME_MS_V4).row).toBe('contact-a')
  })
})

const base = { asleep: false, collapsed: false, walking: false, facing: 'se' as const, nowMs: 0 }

const agent = (over: Partial<AgentBody> = {}): AgentBody => ({
  id: 'farmer', name: 'Farmer', x: 3, y: 4, alive: true, asleep: false,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 10, injuries: [], ill: false, ageDays: 7300, skills: {},
  activity: null, collapsedSinceTick: null, zeroHungerSinceTick: null,
  ...over,
})

const ev = (type: string, payload: unknown, tick = 10): SimEvent => ({ seq: 1, tick, type, payload })

describe('charPose', () => {
  it('asleep beats walking and never bobs', () => {
    expect(charPose({ ...base, asleep: true, walking: true, nowMs: 125 })).toEqual({ row: 'sleep', facing: 'se', bobY: 0 })
    expect(charPose({ ...base, collapsed: true, walking: true })).toEqual({ row: 'sleep', facing: 'se', bobY: 0 })
  })

  it('walks the v2 loop at 8fps with a 1px bob exactly on passing frames', () => {
    const rows = [0, 125, 250, 375].map((nowMs) => charPose({ ...base, walking: true, nowMs }))
    expect(rows.map((r) => r.row)).toEqual([...WALK_LOOP])
    expect(rows.map((r) => r.bobY)).toEqual([0, BOB_PX, 0, BOB_PX])
  })

  it('idles at rest', () => {
    expect(charPose(base)).toEqual({ row: 'idle', facing: 'se', bobY: 0 })
  })
})

describe('interpolatePos (waypoints)', () => {
  it('is exact at the midpoint of a single leg', () => {
    const path = [{ x: 2, y: 6, atMs: 1000 }, { x: 4, y: 6, atMs: 2000 }]
    expect(interpolatePos(path, 1500)).toEqual({ x: 3, y: 6 })
  })
  it('follows the path polyline, never the straight line to the destination', () => {
    // two legs: (2,6)→(4,6)→(4,4). The straight line from start to end would put
    // t=1500 at (3,5); the polyline keeps it on the first leg at (3,6).
    const path = [
      { x: 2, y: 6, atMs: 1000 },
      { x: 4, y: 6, atMs: 2000 },
      { x: 4, y: 4, atMs: 3000 },
    ]
    expect(interpolatePos(path, 1500)).toEqual({ x: 3, y: 6 })
    expect(interpolatePos(path, 2000)).toEqual({ x: 4, y: 6 }) // exactly at the corner waypoint
    expect(interpolatePos(path, 2500)).toEqual({ x: 4, y: 5 }) // on the second leg
  })
  it('clamps before the first and after the last waypoint', () => {
    const path = [{ x: 2, y: 6, atMs: 1000 }, { x: 4, y: 6, atMs: 2000 }]
    expect(interpolatePos(path, 9999)).toEqual({ x: 4, y: 6 })
    expect(interpolatePos(path, 0)).toEqual({ x: 2, y: 6 })
  })
  it('handles a single waypoint', () => {
    expect(interpolatePos([{ x: 5, y: 5, atMs: 100 }], 999)).toEqual({ x: 5, y: 5 })
  })
})

describe('prunePath', () => {
  const path = [
    { x: 0, y: 0, atMs: 0 },
    { x: 1, y: 0, atMs: 100 },
    { x: 2, y: 0, atMs: 200 },
    { x: 2, y: 1, atMs: 300 },
  ]
  it('drops passed waypoints, keeping the last-passed one as the anchor', () => {
    expect(prunePath(path, 150)).toEqual([{ x: 1, y: 0, atMs: 100 }, { x: 2, y: 0, atMs: 200 }, { x: 2, y: 1, atMs: 300 }])
    expect(prunePath(path, 250)).toEqual([{ x: 2, y: 0, atMs: 200 }, { x: 2, y: 1, atMs: 300 }])
  })
  it('keeps the whole path when nothing has passed yet', () => {
    expect(prunePath(path, 50)).toEqual(path)
  })
})

describe('emoteFor', () => {
  it('mirrors the emote atlas order', () => {
    expect(EMOTE_KINDS).toEqual(['exclaim', 'question', 'heart', 'star', 'sleep', 'hunger', 'cold', 'rain', 'hurt', 'talk', 'idea', 'anger'])
  })
  it('injury beats hunger', () => {
    const a = agent({ needs: { hunger: 10, energy: 80, warmth: 80, social: 80 } })
    expect(emoteFor(a, [ev('agent_injured', { agentId: 'farmer', kind: 'minor' })])).toBe('hurt')
  })
  it('talk fires on own agent_spoke in the window, not on others', () => {
    expect(emoteFor(agent(), [ev('agent_spoke', { agentId: 'farmer', text: 'hello' })])).toBe('talk')
    expect(emoteFor(agent(), [ev('agent_spoke', { agentId: 'fisher', text: 'hello' })])).toBeNull()
  })
  it('dead agents emote nothing at all', () => {
    expect(emoteFor(agent({ alive: false }), [ev('agent_injured', { agentId: 'farmer', kind: 'grave' })])).toBeNull()
  })
  it('is null when calm', () => {
    expect(emoteFor(agent(), [])).toBeNull()
  })
})
