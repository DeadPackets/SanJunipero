// ── ★ WHAT THE LEAST-BAD POLICY ALREADY SHIPPED ───────────────────────────────────────────
//
// USER RULING: `bestOf` may not ship a candidate that failed a gate. The question that came
// with it was the important one — *what has it shipped already* — because one measured
// instance almost never means one instance on this project. TACTICAL GEAR was the instance
// somebody happened to see; this is the sweep.
//
// The generator gates against a MASTER figure that is not committed, so this uses the two
// references the v2 standard already names and that ARE committed:
//   walk frames -> the same facing's own idle (`frameCoherenceGate`, exactly as written)
//   sleep       -> the SE idle, once (the generator uses `masterGate.se` and nothing else,
//                  and `deriveSheet` gives all four facings the same one authored sleep cell)
//
// ★ AND ONLY THE AUTHORED FACINGS ARE JUDGED, for a reason that is itself a finding. `sw` is
// an EXACT flip of `se` — measured below, 0 pixels different across all five characters — and
// yet `frameCoherenceGate` returns DIFFERENT verdicts for the two on 4 of 10 pairs: `omar/sw`
// reds on palette 0.6875 while `omar/se` is clean, on the same image mirrored. The cause is
// `gateView`: `downscaleMajority` and `anchorToCanvas` break ties one way on an odd-width
// source and the other way on its mirror, and `paletteJaccard`'s minimum-share floor turns
// those few pixels into a whole cluster appearing or vanishing. A derived-facing verdict
// therefore measures the gate's own rounding, not the art. The generator never sees this
// because it only ever gates `AUTHORED_FACINGS`; it bites an auditor.
//
// THIS FILE PINS THE DEBT, IT DOES NOT BLESS IT. Every entry is a cell that would not pass
// today. Fixing one turns this red, which is the point: the list may only get shorter, and it
// may never get longer without somebody writing the reason down.
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import {
  CELL_V2, FEET_Y_V2, POSES_V2, FACINGS, anchorToCanvas, downscaleMajority,
  frameCoherenceGate, mirrorX, sleepGate,
} from './sheet.js'
import { strideGateV4 } from './mirror.js'
import { alphaBinaryGate, paletteGate, soleSilhouetteGate } from './pixelGates.js'
import { listCommittedCast, type CommittedCharacter } from './castArt.js'

const MAX_ART_H = FEET_Y_V2 + 1
const CALIBRATED_MEDIAN = 0.310
const AUTHORED = ['se', 'ne'] as const
const WALK = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const

function gateView(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  const fitted = k === 1 ? img : downscaleMajority(img,
    Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
    Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))))
  return anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2)
}

const cropper = (c: CommittedCharacter, atlas: RawImage) => (name: string): RawImage => {
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
  for (const f of FACINGS) for (const p of POSES_V2) {
    const native = crop(`${p}-${f}`)
    view.set(`${p}-${f}`, gateView(native))
    for (const s of [...alphaBinaryGate(native).failures, ...paletteGate(native).failures,
      ...soleSilhouetteGate(native).failures]) found.push(`${c.id} ${p}-${f} pixel: ${s}`)
  }
  for (const f of AUTHORED) {
    const idle = view.get(`idle-${f}`)!
    for (const x of frameCoherenceGate(f, idle, WALK.map((p) => ({ label: p, img: view.get(`${p}-${f}`)! }))))
      found.push(`${c.id} ${f} ${x.gate} ${x.a.split('/')[1]}`)
    for (const x of strideGateV4(f, {
      'idle': idle, 'contact-a': view.get(`contact-a-${f}`)!,
      'passing': view.get(`passing-a-${f}`)!, 'contact-b': view.get(`contact-b-${f}`)!,
    }, CALIBRATED_MEDIAN)) found.push(`${c.id} ${f} ${x.gate} ${x.a.split('/')[1]}~${x.b.split('/')[1]}`)
  }
  for (const x of sleepGate('sleep', view.get('idle-se')!, view.get('sleep-se')!))
    found.push(`${c.id} sleep ${x.gate}`)
  return found
}

/**
 * ★ THE DEBT, AS OF THIS SWEEP. Four cells, all of them in the cast; the 20 committed
 * buildings and the 50 committed items are clean. Two of the four are the TACTICAL GEAR
 * family — the model drew something that is not the character, and the gate said so.
 */
export const KNOWN_GATE_DEBT: Record<string, string> = {
  // MINE, and named so it is not mistaken for the model's. The TACTICAL GEAR repair set
  // contact-b-ne := contact-a-ne — the last good frame of the same facing — so Amara's two
  // back-facing walk cycles have no alternating stride. Clears when the strip is redrawn.
  'amara ne stride contact-a~contact-b':
    '0.0000 against 0.1085 — the TACTICAL GEAR repair, by construction',

  // ★ THE SECOND TACTICAL GEAR. Salma's back-facing contact-a has a large brown bundle in her
  // right hand that appears in NO other frame of the cycle: +24.3 % opaque area against a
  // ±18 % tolerance, WORSE than the 1.1855 that shipped the caption. It is in the product —
  // she flashes an object one frame in four walking away from the camera, in ne and nw.
  'salma ne silhouette contact-a':
    '1.2429 against 1.1800 — an object in her hand for one frame in four',

  // Omar's head moves 24 % between idle and contact-a in the back view. Legs move, heads do not.
  'omar ne head contact-a':
    '0.2379 against 0.2000 — head drift in the back-facing contact frame',

  // Yusuf's sleep cell shares 53 % of its palette with his idle against a floor of 80 %. A
  // lying body at gate-view scale is mostly face where a standing one is mostly jacket, so
  // this may be the gate rather than the art — it is the one of the four to look at last.
  'yusuf sleep palette':
    '0.5294 against 0.8000 — sleep vs idle palette, possibly the gate and not the cell',
}

const cast = listCommittedCast()

describe('★ the committed cast against the gates as they now behave', () => {
  it.each(cast.map((c) => [c.id, c] as const))('%s: nothing fails that is not written down', async (_id, c) => {
    const found = failuresOf(c, await decodePng(c.atlas))
    expect(found.filter((k) => KNOWN_GATE_DEBT[k] === undefined),
      'a cast cell fails a gate and nobody wrote down why').toEqual([])
  })

  // The other half of pinning: an entry that no longer fails must be DELETED, or the list
  // stops being a measurement and becomes folklore.
  it('★ the debt list has no fossils — every entry still fails today', async () => {
    const live = new Set<string>()
    for (const c of cast) for (const k of failuresOf(c, await decodePng(c.atlas))) live.add(k)
    expect(Object.keys(KNOWN_GATE_DEBT).filter((k) => !live.has(k)),
      'this entry passes now — delete it from KNOWN_GATE_DEBT').toEqual([])
  })

  it('★ and the debt is FOUR cells, so a jump shows up in the diff', () => {
    expect(Object.keys(KNOWN_GATE_DEBT)).toHaveLength(4)
  })
})

// ★ THE REASON THE SWEEP JUDGES ONLY THE AUTHORED FACINGS, asserted rather than left in prose.
describe('the derived facings are exact mirrors, and the gate still disagrees across them', () => {
  it.each(cast.map((c) => [c.id, c] as const))('%s: sw is flip(se) and nw is flip(ne), to the pixel', async (_id, c) => {
    const crop = cropper(c, await decodePng(c.atlas))
    for (const [authored, derived] of [['se', 'sw'], ['ne', 'nw']] as const) {
      for (const p of ['idle', ...WALK]) {
        const a = mirrorX(crop(`${p}-${authored}`)), b = crop(`${p}-${derived}`)
        expect([a.width, a.height], `${p}-${derived} is not the size of flip(${p}-${authored})`)
          .toEqual([b.width, b.height])
        let diff = 0
        for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++
        expect(diff, `${p}-${derived} is not an exact flip of ${p}-${authored}`).toBe(0)
      }
    }
  })

  // If this ever goes green, `gateView` has been made mirror-safe and the sweep above can be
  // widened to all four facings. Until then a derived-facing verdict is not evidence.
  it('★ yet the same image mirrored gets a different verdict, on at least one character', async () => {
    const disagreements: string[] = []
    for (const c of cast) {
      const crop = cropper(c, await decodePng(c.atlas))
      const verdicts = (f: string): string => frameCoherenceGate(f, gateView(crop(`idle-${f}`)),
        WALK.map((p) => ({ label: p, img: gateView(crop(`${p}-${f}`)) })))
        .map((x) => `${x.gate}:${x.a.split('/')[1]}`).sort().join(',')
      for (const [authored, derived] of [['se', 'sw'], ['ne', 'nw']] as const)
        if (verdicts(authored) !== verdicts(derived))
          disagreements.push(`${c.id} ${authored}=[${verdicts(authored)}] ${derived}=[${verdicts(derived)}]`)
    }
    expect(disagreements.length,
      'the gate no longer measures its own rounding — widen the sweep to all four facings')
      .toBeGreaterThan(0)
  })
})
