import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import {
  FACINGS, POSES_V2, HEAD_DIFF_MAX, STANCE_MIN_RATIO, footSpan, frameCoherenceGate, mirrorX,
  opaqueBbox,
} from './sheet.js'
import {
  AUTHORED_FACINGS, CELL_NAMES_V4, STRIP_POSES_V4, WALK_CYCLE_V4,
  coherenceGateV4, deriveSheet, sleepAxisDeg, sleepAxisGate, stanceGate, strideGateV4,
  type AuthoredSet,
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

// ★ THE GATE `strideGateV4` IS NOT — and the fixture is built so that strideGateV4 PASSES the
// same pair, which is the whole reason this exists.
describe('★ stanceGate: a contact frame with no stride in it', () => {
  // A body with two legs whose spread is a parameter. Torso and head are identical, so the
  // silhouette and the palette cannot see the difference either.
  const walker = (spread: number, armY = 0): RawImage => {
    const w = 40, h = 40
    const data = new Uint8ClampedArray(w * h * 4)
    const put = (x: number, y: number, c: number) => {
      const i = (y * w + x) * 4
      data[i] = c; data[i + 1] = 130; data[i + 2] = 90; data[i + 3] = 255
    }
    for (let y = 4; y < 26; y++) for (let x = 16; x < 24; x++) put(x, y, 190) // torso
    for (let y = 26; y < 38; y++) {                                           // two legs
      const t = (y - 26) / 11
      for (let d = 0; d < 3; d++) {
        put(Math.round(19 - t * spread) + d, y, 120)
        put(Math.round(20 + t * spread) - d, y, 120)
      }
    }
    // arms, high up the body: they move the pixels a lot and the feet not at all
    for (let y = 10 + armY; y < 14 + armY; y++) for (let x = 12; x < 16; x++) put(x, y, 160)
    return { width: w, height: h, data }
  }
  const idle = walker(1)

  it('★ RED on a contact frame no wider at the feet than the idle', () => {
    const f = stanceGate('se', idle, [{ label: 'contact-b', img: walker(1) }])
    expect(f.map((x) => x.gate)).toEqual(['stance'])
    expect(f[0]!.value).toBeLessThan(STANCE_MIN_RATIO)
    expect(f[0]!.a).toBe('se/contact-b')
  })

  it('clean on a real stride', () => {
    expect(stanceGate('se', idle, [{ label: 'contact-a', img: walker(9) }])).toEqual([])
  })

  // ★ THE POINT. `strideGateV4` sees a difference between the two frames and passes them both;
  // the standing one is a walk frame with no walk in it and only the stance gate says so.
  it('★ and strideGateV4 passes the pair that stanceGate refuses', () => {
    const strip = {
      'idle': idle, 'contact-a': walker(9), 'passing': walker(0, 8), 'contact-b': walker(1, 4),
    }
    expect(strideGateV4('se', strip, 0.02), 'the fixture must clear the stride gate').toEqual([])
    expect(stanceGate('se', idle, [{ label: 'contact-b', img: strip['contact-b'] }])
      .map((x) => x.gate)).toEqual(['stance'])
  })

  // Feet, not arms: a swung arm widens the bbox and must not buy a stance.
  it('measures the feet, so an outstretched arm does not buy a stance', () => {
    const armed = walker(1)
    for (let x = 2; x < 16; x++) for (let y = 8; y < 11; y++) {
      const i = (y * 40 + x) * 4
      armed.data[i] = 190; armed.data[i + 1] = 130; armed.data[i + 2] = 90; armed.data[i + 3] = 255
    }
    expect(footSpan(armed)).toBe(footSpan(walker(1)))
    expect(stanceGate('se', idle, [{ label: 'contact-a', img: armed }]).map((x) => x.gate))
      .toEqual(['stance'])
  })
})
