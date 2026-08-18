import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { FACINGS, POSES_V2, mirrorX, opaqueBbox } from './sheet.js'
import {
  AUTHORED_FACINGS, CELL_NAMES_V4, STRIP_POSES_V4, WALK_CYCLE_V4,
  deriveSheet, sleepAxisDeg, sleepAxisGate, type AuthoredSet,
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
