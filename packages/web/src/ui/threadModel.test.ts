import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, ThreadRowSchema, type StakeScore, type ThreadRow } from '@sj/shared'
import { boardRows, daysRunning, heatShare, threadCapsules } from './threadModel.js'

const row = (over: Partial<ThreadRow> = {}): ThreadRow =>
  ThreadRowSchema.parse({
    id: 'th_well',
    members: ['amara', 'salma'],
    heat: 12,
    peak: 24,
    state: 'rising',
    valence: -1,
    openedTick: 0,
    lastPaidTick: 100,
    terms: ['quarrel'],
    ...over,
  })

const score = (over: Partial<StakeScore> = {}): StakeScore => ({
  sceneId: 'sc_1',
  agentIds: ['amara'],
  score: 10,
  why: 'Amara: falling out',
  ...over,
})

describe('the capsule model', () => {
  it('counts the days a story has been running to one place', () => {
    expect(daysRunning(0, MINUTES_PER_DAY * 6 + 720)).toBe(6.5)
    expect(daysRunning(MINUTES_PER_DAY, 0)).toBe(0)
  })

  // The gateway's heat is unbounded and every bar on screen is a share of the story's own peak.
  it('never lets a bar leave its box, whatever the frame says', () => {
    expect(heatShare(12, 24)).toBe(0.5)
    expect(heatShare(99, 24)).toBe(1)
    expect(heatShare(-5, 24)).toBe(0)
    expect(heatShare(5, 0)).toBe(0)
    expect(heatShare(Number.NaN, 24)).toBe(0)
    expect(heatShare(5, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('caps the cast at what a capsule can overlap and counts the rest', () => {
    const [cap] = threadCapsules([row({ members: ['a', 'b', 'c', 'd', 'e', 'f'] })], { now: 0 })
    expect(cap?.cast).toEqual(['a', 'b', 'c', 'd'])
    expect(cap?.more).toBe(2)
  })

  // ★ The camera's cut agrees with the top row on under half of the ticks of a real log, so the
  // capsule on screen is marked and it is usually not the first one.
  it('★ marks the story the camera is on, which is rarely the head', () => {
    const rows = [
      row({ id: 'th_1', members: ['amara', 'salma'] }),
      row({ id: 'th_2', members: ['omar', 'yusuf'] }),
    ]
    const caps = threadCapsules(rows, { now: 0, cutCast: ['omar', 'yusuf'] })
    expect(caps.map((c) => c.onScreen)).toEqual([false, true])
    // a cut whose cast straddles two stories lights the wider overlap, and only one row
    const split = threadCapsules(rows, { now: 0, cutCast: ['salma', 'omar', 'yusuf'] })
    expect(split.map((c) => c.onScreen)).toEqual([false, true])
    // nobody on the ribbon is in the shot: nothing is marked
    expect(threadCapsules(rows, { now: 0, cutCast: ['stranger'] }).some((c) => c.onScreen)).toBe(
      false,
    )
  })

  // A story that merges away shipped one last row and then vanished 38 times on a real log.
  it('reads a merged story as a handover rather than a hole', () => {
    const [cap] = threadCapsules([row({ state: 'closed', became: 'th_council' })], { now: 0 })
    expect(cap).toMatchObject({ state: 'closed', handover: 'th_council' })
    expect(threadCapsules([row()], { now: 0 })[0]?.handover).toBeNull()
  })

  it('takes the town prose for its sentence and never the camera vocabulary', () => {
    const beat = 'Amara would not let it go and Salma walked off.'
    const [cap] = threadCapsules([row({ beat, proseTick: 40, terms: ['quarrel', 'slight'] })], {
      now: 60,
    })
    expect(cap?.line).toMatchObject({ text: beat, rung: 'beat', ageTicks: 20 })
    // nothing written about it yet, and the capsule says nothing rather than a fixed phrase
    expect(threadCapsules([row()], { now: 60 })[0]?.line).toBeNull()
  })

  it('does not print the same head on two capsules in one frame', () => {
    const beat = 'They argued over the well.'
    const caps = threadCapsules(
      [row({ id: 'a', beat }), row({ id: 'b', beat, summary: 'Salma walked off.' })],
      { now: 10 },
    )
    expect(caps[0]?.line?.text).toBe(beat)
    expect(caps[1]?.line?.text).toBe('Salma walked off.')
  })

  it('takes the chronicle sentence when the town has closed no scene', () => {
    const [cap] = threadCapsules([row()], { now: 10, chronicleOf: () => 'Salma left the well.' })
    expect(cap?.line).toMatchObject({ rung: 'chronicle', text: 'Salma left the well.' })
  })
})

describe('the shot board', () => {
  it('normalises every row against the top of its own frame', () => {
    const rows = boardRows([score({ score: 20 }), score({ score: 5 }), score({ score: 0 })])
    expect(rows.map((r) => r.share)).toEqual([1, 0.25, 0])
    expect(rows.some((r) => 'score' in r)).toBe(false)
  })

  it('holds at zero when nothing is scored at all', () => {
    expect(boardRows([score({ score: 0 })])[0]?.share).toBe(0)
    expect(boardRows([])).toEqual([])
  })
})
