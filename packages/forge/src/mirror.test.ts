import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import {
  FACINGS, POSES_V2, HEAD_DIFF_MAX, frameCoherenceGate, mirrorX, opaqueBbox,
} from './sheet.js'
import {
  AUTHORED_FACINGS, CELL_NAMES_V4, STRIP_POSES_V4, WALK_CYCLE_V4,
  coherenceGateV4, deriveSheet, sleepAxisDeg, sleepAxisGate, type AuthoredSet,
} from './mirror.js'

// 4×4 with a single opaque marker pixel — asymmetric so flips are detectable.
function marker(x: number, y: number, r = 200): RawImage {
  const data = new Uint8ClampedArray(4 * 4 * 4)
  const i = (y * 4 + x) * 4
  data[i] = r; data[i + 1] = 50; data[i + 2] = 50; data[i + 3] = 255
  return { width: 4, height: 4, data }
}

function makeAuthored(): AuthoredSet {
  const strip = (base: number) => Object.fromEntries(
    STRIP_POSES_V4.map((p, i) => [p, marker(i % 4, base, 100 + i)]),
  ) as Record<(typeof STRIP_POSES_V4)[number], RawImage>
  return { strips: { se: strip(0), ne: strip(1) }, sleep: marker(3, 3) }
}

describe('CELL_NAMES_V4 contract', () => {
  it('has exactly the 24 renderer cell names, no dupes', () => {
    expect(CELL_NAMES_V4.length).toBe(24)
    expect(new Set(CELL_NAMES_V4).size).toBe(24)
    for (const p of POSES_V2) for (const f of FACINGS)
      expect(CELL_NAMES_V4).toContain(`${p}-${f}`)
  })
})

describe('deriveSheet', () => {
  const sheet = deriveSheet(makeAuthored())

  it('produces exactly the 24-cell contract', () => {
    expect([...sheet.keys()].sort()).toEqual([...CELL_NAMES_V4].sort())
  })

  it('mirrors SW from SE and NW from NE pixel-exactly, for every strip pose', () => {
    const authored = makeAuthored()
    for (const p of ['idle', 'contact-a', 'contact-b'] as const) {
      expect(sheet.get(`${p}-sw`)!.data).toEqual(mirrorX(authored.strips.se[p]).data)
      expect(sheet.get(`${p}-nw`)!.data).toEqual(mirrorX(authored.strips.ne[p]).data)
    }
    expect(sheet.get('passing-a-sw')!.data).toEqual(mirrorX(authored.strips.se.passing).data)
    expect(sheet.get('passing-b-nw')!.data).toEqual(mirrorX(authored.strips.ne.passing).data)
  })

  it('reuses the single passing frame for passing-a and passing-b', () => {
    for (const f of AUTHORED_FACINGS)
      expect(sheet.get(`passing-a-${f}`)).toBe(sheet.get(`passing-b-${f}`))
  })

  it('maps sleep: se/sw = the cell, ne/nw = its flip', () => {
    const authored = makeAuthored()
    expect(sheet.get('sleep-se')!.data).toEqual(authored.sleep.data)
    expect(sheet.get('sleep-sw')).toBe(sheet.get('sleep-se'))
    expect(sheet.get('sleep-ne')!.data).toEqual(mirrorX(authored.sleep).data)
    expect(sheet.get('sleep-nw')).toBe(sheet.get('sleep-ne'))
  })

  it('double flip is identity', () => {
    const img = marker(1, 2)
    expect(mirrorX(mirrorX(img)).data).toEqual(img.data)
  })
})

describe('WALK_CYCLE_V4', () => {
  it('plays contact-a → passing → contact-b → passing (F1-F2-F1-F3)', () => {
    expect(WALK_CYCLE_V4).toEqual(['contact-a', 'passing', 'contact-b', 'passing'])
  })
})

// The five shipped sleep-se cells, at an exact /4. omar and salma are the poses the user
// approved; amara, nadia and yusuf are the three they rejected.
const sleeper = (id: string): Promise<RawImage> =>
  decodePng(readFileSync(new URL(`./fixtures/pixel-gates/sleep-${id}-64.png`, import.meta.url)))

describe('sleepAxisDeg', () => {
  it('puts the two approved sleepers inside one narrow band', async () => {
    expect(sleepAxisDeg(await sleeper('omar'))).toBeCloseTo(-36.4, 0)
    expect(sleepAxisDeg(await sleeper('salma'))).toBeCloseTo(-38.9, 0)
  })

  it('separates the three rejected cells from that band, and says how each is wrong', async () => {
    // mirrored: the sign flips, the magnitude is right
    expect(sleepAxisDeg(await sleeper('amara'))).toBeCloseTo(31.5, 0)
    // flat: drawn across the screen instead of along the ground
    expect(sleepAxisDeg(await sleeper('nadia'))).toBeCloseTo(-11.8, 0)
    // flat AND mirrored
    expect(sleepAxisDeg(await sleeper('yusuf'))).toBeCloseTo(6.6, 0)
  })
})

describe('sleepAxisGate', () => {
  it('passes the two the user approved', async () => {
    for (const id of ['omar', 'salma']) expect(sleepAxisGate(await sleeper(id))).toEqual([])
  })

  // RED proof: every one of these shipped, and `aspect > 1` passed all three.
  it('RED on all three the user rejected', async () => {
    for (const id of ['amara', 'nadia', 'yusuf']) {
      const f = sleepAxisGate(await sleeper(id))
      expect(f, id).toHaveLength(1)
      expect(f[0]!.gate).toBe('lying-axis')
    }
  })

  it('★ the old aspect check cannot see any of it — that is why three of five shipped', async () => {
    for (const id of ['amara', 'nadia', 'yusuf']) {
      const bb = opaqueBbox(await sleeper(id))!
      expect((bb.x1 - bb.x0 + 1) / (bb.y1 - bb.y0 + 1), id).toBeGreaterThan(1)
    }
  })

  it('the band is signed, so a mirrored body fails even at the right magnitude', async () => {
    const amara = await sleeper('amara')
    expect(sleepAxisGate(amara)).toHaveLength(1)
    expect(sleepAxisGate(mirrorX(amara))).toEqual([])
  })
})


// ── ★ THE PRE-SPEND GATE MUST NOT BE WEAKER THAN THE POST-HOC AUDIT ───────────────────────
//
// `coherenceGateV4` decides which candidate a live-spend generator ships. `frameCoherenceGate`
// asks the same question of the cells afterwards, in `castAudit.test.ts`. Until this lane the
// first asked TWO questions and the second asked THREE — so a candidate could clear the gate
// that costs money and red the gate that costs nothing, which is the worst way round.
//
// Measured, live: salma's regenerated `ne/contact-a` cleared the generator (silhouette and
// palette clean) and reds the audit at head 0.3366 against 0.20. The gate had no head term to
// stop it with. `omar ne/contact-a` at 0.2379 is the same hole, already in the tree.
//
// This file had NO test for `coherenceGateV4` at all before now — the gate that chooses every
// walk frame in the cast.
describe('★ coherenceGateV4 asks everything frameCoherenceGate asks', () => {
  // Two bodies, same palette and same area, DIFFERENT HEADS: a 16-wide torso with a head
  // block that moves. Area is equal to the pixel, so silhouette and palette cannot see it.
  const body = (headX: number): RawImage => {
    const w = 24, h = 24
    const data = new Uint8ClampedArray(w * h * 4)
    const put = (x: number, y: number) => {
      const i = (y * w + x) * 4
      data[i] = 190; data[i + 1] = 130; data[i + 2] = 90; data[i + 3] = 255
    }
    for (let y = 10; y < 22; y++) for (let x = 6; x < 18; x++) put(x, y)   // torso, identical
    for (let y = 2; y < 9; y++) for (let x = headX; x < headX + 7; x++) put(x, y)  // head, moves
    return { width: w, height: h, data }
  }

  const master = body(9)
  const drifted = body(2)

  it('★ RED on a head that moved, with the silhouette and the palette identical', () => {
    const f = coherenceGateV4('cell', master, drifted)
    expect(f.map((x) => x.gate), 'the head moved and only the head moved').toEqual(['head'])
    expect(f[0]!.limit).toBe(HEAD_DIFF_MAX)
    expect(f[0]!.value).toBeGreaterThan(HEAD_DIFF_MAX)
  })

  it('clean on the same body against itself', () => {
    expect(coherenceGateV4('cell', master, body(9))).toEqual([])
  })

  // ★ THE PROPERTY, not the term. Whatever either gate learns to ask, they ask the same set —
  // otherwise the money is spent behind the weaker one.
  it('★ and the two gates agree on the same pair, term for term', () => {
    const mine = coherenceGateV4('cell', master, drifted).map((x) => x.gate).sort()
    const theirs = frameCoherenceGate('ne', master, [{ label: 'cell', img: drifted }])
      .map((x) => x.gate).sort()
    expect(mine, 'the pre-spend gate and the audit disagree about what is wrong').toEqual(theirs)
  })
})
