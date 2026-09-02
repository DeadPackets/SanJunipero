import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { facingFrom } from './iso.js'
import {
  EARSHOT_TILES,
  MAX_LIVE_THOUGHTS,
  PRIOR_ALPHA,
  PRIOR_HOLD_MS,
  REPLY_WINDOW_MS,
  TYPE_CHARS_PER_S,
  createConversation,
  fateOfPriorLine,
  thoughtsToEnd,
  typedChars,
  typingMs,
} from './converse.js'

// ★ Two people spoke and the town showed two paragraph slabs, neither facing the other, the
// first gone before the second arrived. Nothing said the two lines were one exchange.

describe('★ a body turns to whoever it is answering', () => {
  it('★ faces the last other voice heard within earshot', () => {
    const talk = createConversation()
    talk.heard({ agentId: 'amara', x: 10, y: 10, atMs: 0 })
    expect(talk.partnerOf('yusuf', 12, 10, 100)).toBe('amara')
    // ...and the facing follows from where the two of them are standing: Amara is two tiles
    // back along x, which the dimetric projection puts up and to the left of Yusuf.
    expect(facingFrom(10 - 12, 10 - 10)).toBe('nw')
    expect(facingFrom(12 - 10, 10 - 10)).toBe('se') // and Amara turns back the other way
  })

  it('★ flips as the floor passes: whoever spoke last is who the next speaker turns to', () => {
    const talk = createConversation()
    talk.heard({ agentId: 'amara', x: 10, y: 10, atMs: 0 })
    talk.heard({ agentId: 'yusuf', x: 12, y: 10, atMs: 1000 })
    expect(talk.partnerOf('amara', 10, 10, 1100)).toBe('yusuf')
    talk.heard({ agentId: 'omar', x: 11, y: 11, atMs: 2000 })
    expect(talk.partnerOf('amara', 10, 10, 2100)).toBe('omar')
  })

  it('never answers itself, however many times it speaks', () => {
    const talk = createConversation()
    for (const atMs of [0, 500, 1000]) talk.heard({ agentId: 'amara', x: 10, y: 10, atMs })
    expect(talk.partnerOf('amara', 10, 10, 1100)).toBe(null)
  })

  it('answers nobody out of earshot, and nobody who spoke too long ago', () => {
    const talk = createConversation()
    talk.heard({ agentId: 'far', x: 10 + EARSHOT_TILES + 1, y: 10, atMs: 0 })
    expect(talk.partnerOf('amara', 10, 10, 100)).toBe(null)

    const old = createConversation()
    old.heard({ agentId: 'amara', x: 10, y: 10, atMs: 0 })
    expect(old.partnerOf('yusuf', 10, 10, REPLY_WINDOW_MS)).toBe('amara')
    expect(old.partnerOf('yusuf', 10, 10, REPLY_WINDOW_MS + 1)).toBe(null)
  })

  it('has nothing to say before anybody has spoken', () => {
    expect(createConversation().partnerOf('amara', 0, 0, 0)).toBe(null)
  })

  it('copies `movement.earshotRadius` rather than choosing its own idea of hearing', () => {
    expect(EARSHOT_TILES).toBe(DEFAULT_CONFIG.movement.earshotRadius)
  })
})

describe('★ the line types in rather than landing whole', () => {
  it('★ advances with time, at TYPE_CHARS_PER_S', () => {
    expect(TYPE_CHARS_PER_S).toBe(28)
    expect(typedChars(60, 0)).toBe(0)
    expect(typedChars(60, 500)).toBe(14)
    expect(typedChars(60, 1000)).toBe(28)
    expect(typedChars(60, 2000)).toBe(56)
  })

  it('★ never runs backwards, and never past the line', () => {
    let last = -1
    for (let t = 0; t < 4000; t += 17) {
      const n = typedChars(40, t)
      expect(n).toBeGreaterThanOrEqual(last)
      expect(n).toBeLessThanOrEqual(40)
      last = n
    }
    expect(typedChars(40, 1e9)).toBe(40)
    expect(typedChars(40, -100)).toBe(0)
  })

  it('says how long a whole line takes, and the reveal is finished by then', () => {
    for (const len of [1, 13, 40, 240]) {
      expect(typedChars(len, typingMs(len))).toBe(len)
      expect(typedChars(len, typingMs(len) - 1000 / TYPE_CHARS_PER_S - 1)).toBeLessThan(len)
    }
  })
})

describe('★ the line before this one stays, and dims', () => {
  it('holds for six seconds at six tenths', () => {
    expect(PRIOR_HOLD_MS).toBe(6000)
    expect(PRIOR_ALPHA).toBe(0.6)
  })

  it('★ the bubble layer holds a line once it is answered, and lets go on the third', () => {
    const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('PRIOR_HOLD_MS')
    expect(SRC).toContain('PRIOR_ALPHA')
    expect(SRC).toContain('typedChars(')
  })

  it('★ the character layer turns a talking body toward its partner', () => {
    const SRC = readFileSync(new URL('./characters.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('partnerOf(')
    expect(SRC).toMatch(/facingFrom\(/)
  })
})

// ★ Nothing ever ended a thought, so they stacked until each timed out and the desk frame caught
// two of them overlapping. A mind holds one thought; the street holds two.
describe('★ one live thought a mind, and two on screen', () => {
  const think = (agentId: string, bornMs: number) => ({ agentId, bornMs })

  it('★ ends a mind’s own earlier thought the moment it thinks again', () => {
    expect(thoughtsToEnd([think('amara', 0)], 'amara')).toEqual([0])
    expect(thoughtsToEnd([think('amara', 0), think('amara', 100)], 'amara')).toEqual([0, 1])
  })

  it('★ ends the oldest when a third would stand', () => {
    expect(MAX_LIVE_THOUGHTS).toBe(2)
    expect(thoughtsToEnd([think('amara', 0), think('yusuf', 100)], 'omar')).toEqual([0])
    expect(thoughtsToEnd([think('yusuf', 100), think('amara', 0)], 'omar')).toEqual([1])
  })

  it('leaves one other mind’s thought alone — two on screen is the rule, not one', () => {
    expect(thoughtsToEnd([think('amara', 0)], 'yusuf')).toEqual([])
    expect(thoughtsToEnd([], 'yusuf')).toEqual([])
  })

  it('★ never leaves more than two standing, however many were already up', () => {
    const live = [think('a', 0), think('b', 10), think('c', 20), think('d', 30)]
    for (const thinker of ['a', 'b', 'e']) {
      const left = live.length - thoughtsToEnd(live, thinker).length
      expect(left + 1, thinker).toBeLessThanOrEqual(MAX_LIVE_THOUGHTS)
    }
  })

  it('★ speech still never ends a thought: it is not part of the exchange', () => {
    for (const speaker of ['amara', 'yusuf']) {
      expect(fateOfPriorLine({ agentId: 'amara', isThought: true, dimmed: false }, speaker)).toBe(
        'keep',
      )
    }
  })

  it('★ the layer applies it on every thought, and leaves speech on its own rule', () => {
    const SRC = readFileSync(new URL('./bubbles.ts', import.meta.url), 'utf8')
    expect(SRC).toContain('for (const i of thoughtsToEnd(live, agentId)) live[i]!.dieMs = now')
    expect(SRC).toContain('const live = bubbles.filter((b) => b.isThought)')
  })
})
