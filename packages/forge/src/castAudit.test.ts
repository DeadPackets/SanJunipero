// Pins the cells that would fail the gate today; the list may only get shorter.
import { describe, expect, it } from 'vitest'
import { decodePng, visiblePixelDiffs, type RawImage } from './post/raw.js'
import {
  CELL_V2,
  FEET_Y_V2,
  POSES_V2,
  FACINGS,
  anchorToCanvas,
  cellDistance,
  crossFacingDupeGate,
  downscaleMajority,
  frameCoherenceGate,
  headRegionDiff,
  mirrorX,
  opaqueArea,
  opaqueBbox,
} from './sheet.js'
import { sleepAxisDeg, sleepCoherenceGateV4, stanceGate, strideGateV4 } from './mirror.js'
import {
  alphaBinaryGate,
  PALETTE_DISTANCE_MAX,
  paletteDistance,
  soleSilhouetteGate,
} from './pixelGates.js'
import { listCommittedCast, type CommittedCharacter } from './castArt.js'
import { trimToFigure } from './hires.js'

const MAX_ART_H = FEET_Y_V2 + 1
const CALIBRATED_MEDIAN = 0.31
const AUTHORED = ['se', 'ne'] as const
const WALK = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const

function fitForGate(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  return k === 1
    ? img
    : downscaleMajority(
        img,
        Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
        Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))),
      )
}
// Trimmed first, which is `gen-cast-v5`'s own gate view: the fit below then normalises scale,
// so a figure's position in its 256 canvas does not read as a broken head.
const gateView = (img: RawImage): RawImage =>
  anchorToCanvas(fitForGate(trimToFigure(img)), CELL_V2, CELL_V2, FEET_Y_V2)

const cropper =
  (c: CommittedCharacter, atlas: RawImage) =>
  (name: string): RawImage => {
    const r = c.manifest.cells[name]!
    const out: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
    for (let y = 0; y < r.h; y++) {
      const s = ((r.y + y) * atlas.width + r.x) * 4
      out.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
    }
    return out
  }

/** Every gate failure a character's committed cells produce, as stable keys. */
function failuresOf(c: CommittedCharacter, atlas: RawImage): string[] {
  const crop = cropper(c, atlas)
  const view = new Map<string, RawImage>()
  const found: string[] = []
  for (const f of FACINGS)
    for (const p of POSES_V2) {
      const native = crop(`${p}-${f}`)
      view.set(`${p}-${f}`, gateView(native))
      for (const s of [...alphaBinaryGate(native).failures, ...soleSilhouetteGate(native).failures])
        found.push(`${c.id} ${p}-${f} pixel: ${s}`)
      const distance = paletteDistance(native)
      if (distance >= PALETTE_DISTANCE_MAX)
        found.push(
          `${c.id} ${p}-${f} pixel: palette distance ${distance.toFixed(1)} over ${PALETTE_DISTANCE_MAX}`,
        )
    }
  for (const f of AUTHORED) {
    const idle = view.get(`idle-${f}`)!
    for (const x of frameCoherenceGate(
      f,
      idle,
      WALK.map((p) => ({ label: p, img: view.get(`${p}-${f}`)! })),
    ))
      found.push(`${c.id} ${f} ${x.gate} ${x.a.split('/')[1]}`)
    for (const x of strideGateV4(
      f,
      {
        idle: idle,
        'contact-a': view.get(`contact-a-${f}`)!,
        passing: view.get(`passing-a-${f}`)!,
        'contact-b': view.get(`contact-b-${f}`)!,
      },
      CALIBRATED_MEDIAN,
    ))
      found.push(`${c.id} ${f} ${x.gate} ${x.a.split('/')[1]}~${x.b.split('/')[1]}`)
    // ★ AND WHETHER A CONTACT FRAME IS A CONTACT POSE, which nothing has ever asked. On the
    // NATIVE cells: the whole separation is 0.19 wide and the gate canvas cannot hold it.
    for (const x of stanceGate(
      f,
      crop(`idle-${f}`),
      ['contact-a', 'contact-b'].map((p) => ({ label: p, img: crop(`${p}-${f}`) })),
    ))
      found.push(`${c.id} ${f} ${x.gate} ${x.a.split('/')[1]}`)
  }
  // AUTHORED facings only: `sw`/`nw` are mirrors by construction, so judging them would fire
  // `mirror-dupe` by design and say nothing about the drawing.
  for (const p of ['idle', ...WALK]) {
    for (const x of crossFacingDupeGate(
      AUTHORED.map((f) => ({ label: `${f}/${p}`, img: view.get(`${p}-${f}`)! })),
      CALIBRATED_MEDIAN,
    ))
      found.push(`${c.id} ${p} ${x.gate} ${x.a}~${x.b}`)
  }
  for (const x of sleepCoherenceGateV4(view.get('sleep-se')!)) found.push(`${c.id} sleep ${x.gate}`)
  return found
}

/** Empty: adding an entry back requires a written reason. */
export const KNOWN_GATE_DEBT: Record<string, string> = {}

const cast = listCommittedCast()

// One decode and one gate sweep per character for the whole file: 5 MB of atlases, and the
// sweep is a pure function of their bytes.
const ATLAS = new Map<string, Promise<RawImage>>()
function atlasOf(c: CommittedCharacter): Promise<RawImage> {
  const hit = ATLAS.get(c.id)
  if (hit) return hit
  const decoded = decodePng(c.atlas)
  ATLAS.set(c.id, decoded)
  return decoded
}

const FAILS = new Map<string, Promise<string[]>>()
function failsOf(c: CommittedCharacter): Promise<string[]> {
  const hit = FAILS.get(c.id)
  if (hit) return hit
  const found = atlasOf(c).then((atlas) => failuresOf(c, atlas))
  FAILS.set(c.id, found)
  return found
}

describe('★ the committed cast against the gates as they now behave', () => {
  it.each(cast.map((c) => [c.id, c] as const))(
    '%s: nothing fails that is not written down',
    async (_id, c) => {
      const found = await failsOf(c)
      expect(
        found.filter((k) => KNOWN_GATE_DEBT[k] === undefined),
        'a cast cell fails a gate and nobody wrote down why',
      ).toEqual([])
    },
  )

  // The other half of pinning: an entry that no longer fails must be DELETED, or the list
  // stops being a measurement and becomes folklore.
  it('★ the debt list has no fossils — every entry still fails today', async () => {
    const live = new Set<string>()
    for (const c of cast) for (const k of await failsOf(c)) live.add(k)
    expect(
      Object.keys(KNOWN_GATE_DEBT).filter((k) => !live.has(k)),
      'this entry passes now — delete it from KNOWN_GATE_DEBT',
    ).toEqual([])
  })

  // The tightest margins on the shipped cast: yusuf ne/contact-a silhouette 1.1687 against the
  // 1.18 bar, and nadia ne/contact-b head 0.1963 against 0.20.
  it('★ and the debt is NOTHING, so a jump shows up in the diff', () => {
    expect(Object.keys(KNOWN_GATE_DEBT)).toHaveLength(0)
  })
})

// ★ THE REASON THE SWEEP JUDGES ONLY THE AUTHORED FACINGS, asserted rather than left in prose.
describe('the derived facings are exact mirrors, and the gate now agrees across them', () => {
  it.each(cast.map((c) => [c.id, c] as const))(
    '%s: sw is flip(se) and nw is flip(ne), to the pixel',
    async (_id, c) => {
      const crop = cropper(c, await atlasOf(c))
      for (const [authored, derived] of [
        ['se', 'sw'],
        ['ne', 'nw'],
      ] as const) {
        for (const p of ['idle', ...WALK]) {
          const a = mirrorX(crop(`${p}-${authored}`)),
            b = crop(`${p}-${derived}`)
          expect(
            [a.width, a.height],
            `${p}-${derived} is not the size of flip(${p}-${authored})`,
          ).toEqual([b.width, b.height])
          expect(
            visiblePixelDiffs(a, b),
            `${p}-${derived} is not an exact flip of ${p}-${authored}`,
          ).toBe(0)
        }
      }
    },
  )

  it('★ every measured value is identical on a facing and on its mirror', async () => {
    const disagreements: string[] = []
    for (const c of cast) {
      const crop = cropper(c, await atlasOf(c))
      // every term of every frame, not only the ones over threshold: a verdict-level check
      // goes on passing while the numbers drift up to the bar, which is how this hid.
      const values = (f: string): string => {
        const idle = gateView(crop(`idle-${f}`)),
          ia = opaqueArea(idle)
        return WALK.map((p) => {
          const x = gateView(crop(`${p}-${f}`))
          return `${p} ${(opaqueArea(x) / ia).toFixed(6)} ` + headRegionDiff(idle, x).toFixed(6)
        }).join(' | ')
      }
      for (const [authored, derived] of [
        ['se', 'sw'],
        ['ne', 'nw'],
      ] as const)
        if (values(authored) !== values(derived))
          disagreements.push(
            `${c.id}\n  ${authored} ${values(authored)}\n  ${derived} ${values(derived)}`,
          )
    }
    expect(disagreements, 'the gate answers differently on the same pixels flipped').toEqual([])
  })

  // An ODD opaque-bbox width has no centred placement that is its own mirror, so the sprite lands
  // one column off between an image and its flip — which is why `strideGateV4` stays authored-only.
  it('the residual is the anchor, it is exactly one column, and only cellDistance sees it', async () => {
    const crop = cropper(cast[0]!, await atlasOf(cast[0]!))
    let odd = 0
    for (const p of ['idle', ...WALK]) {
      const fitted = fitForGate(crop(`${p}-se`))
      const b = opaqueBbox(fitted)!
      if ((b.x1 - b.x0 + 1) % 2 === 0) continue
      odd++
      const lhs = anchorToCanvas(mirrorX(fitted), CELL_V2, CELL_V2, FEET_Y_V2)
      const rhs = mirrorX(anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2))
      expect(
        Math.abs(opaqueBbox(lhs)!.x0 - opaqueBbox(rhs)!.x0),
        'the anchor is off by more than one column',
      ).toBe(1)
      // and the terms that do not care, do not care
      expect(opaqueArea(lhs)).toBe(opaqueArea(rhs))
      expect(headRegionDiff(lhs, rhs)).toBe(0)
      expect(cellDistance(lhs, rhs), 'cellDistance would not see the shift').toBeGreaterThan(0)
    }
    expect(odd, 'no odd-width bbox in this sheet — the residual is unexercised').toBeGreaterThan(0)
  })
})

// The model likes to draw floating "z"s on a sleeping villager: nadia shipped 145 px over 3
// islands, 0.748%, inside the 1% detached bound. ONE island is the property with no threshold.
describe('every committed sleep cell is ONE shape — no captions, no props', () => {
  it.each(cast.map((c) => [c.id, c] as const))('%s', async (id, c) => {
    const crop = cropper(c, await atlasOf(c))
    for (const f of FACINGS) {
      const g = soleSilhouetteGate(crop(`sleep-${f}`))
      expect(g.islands, `${id} sleep-${f} has ${g.islands} islands`).toBe(1)
    }
  })
})

// ★ THE OTHER HALF OF "THE TWO GATES ASK THE SAME SET", stated as a number rather than left in
// prose: every committed sleeper lies along the ground diagonal, head up-right.
describe('every committed sleep cell lies along the ground, not across the screen', () => {
  it.each(cast.map((c) => [c.id, c] as const))('%s', async (id, c) => {
    const atlas = await atlasOf(c)
    const deg = sleepAxisDeg(cropper(c, atlas)('sleep-se'))
    expect(deg, `${id} sleeps at ${deg.toFixed(1)} deg`).toBeGreaterThanOrEqual(-50)
    expect(deg, `${id} sleeps at ${deg.toFixed(1)} deg`).toBeLessThanOrEqual(-20)
  })
})
