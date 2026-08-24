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
// yet `frameCoherenceGate` returns DIFFERENT verdicts for the two on 3 of 10 pairs.
//
// ★ THE CAUSE THIS FILE USED TO NAME IS NOT THE CAUSE. It said `downscaleMajority` and
// `anchorToCanvas` break ties one way on an odd-width source and the other way on its mirror.
// Both were removed in a scratchpad build and measured against the committed cast:
//
//   as shipped              3/10 disagreements   gateView(flip) vs flip(gateView): 30 635 px
//   canonical tie-break     3/10                                                   30 456 px
//   + even-parity centring  3/10                                                   30 456 px
//   + palindromic boxes     3/10                                                   27 994 px
//
// An 8.6 % reduction on an error that covers ~6.6 % of every 96x96 gate canvas, and the count
// does not move. The palindromic variant only changes WHICH pairs disagree — omar drops out
// and nadia comes in — which is the worst outcome of all: it looks like progress and is not.
//
// The real cause is majority downscale at a NON-INTEGER factor. A 954 px figure becomes ~90 px,
// factor ~10.6, so the source boxes alternate 10 and 11 columns wide. Mirroring the source
// re-partitions it, and the modal colour of a 10-wide box is honestly not the modal colour of
// the 11-wide box its mirror lands in. No tie-break rule reaches that; only an integer factor
// would, and the figure heights come from the model.
//
// SO IT IS RECORDED AND NOT FIXED — see the report. Judging a derived facing carries ZERO
// information anyway: `deriveSheet` builds `sw` as `mirrorX(se)` and the test below asserts
// the two are identical to the pixel, so a derived verdict is the authored art measured a
// second time through a lossy asymmetric lens. The generator never sees this because it only
// ever gates `AUTHORED_FACINGS`; it bites an auditor who forgets the mirror law.
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
import { sleepAxisDeg, sleepAxisGate, strideGateV4 } from './mirror.js'
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
  // ★ AND THE AXIS, WHICH THE AUDIT WAS NOT ASKING. The head-term gap ran the other way:
  // `coherenceGateV4` (pre-spend) asked less than `frameCoherenceGate` (post-hoc). For SLEEP
  // it is the audit that asks less — `sleepGate` checks palette and wider-than-tall, while the
  // generator's `sleepCoherenceGateV4` also checks that the body lies ALONG the ground diagonal
  // rather than flat across the screen. A body drawn flat passes `aspect > 1`; three of the
  // five shipped that way once. All five committed cells are in the band today
  // (-33.4, -36.1, -37.7, -38.0, -36.2 against -50..-20), so asking costs nothing and the
  // two gates now ask the same set in both directions.
  for (const x of sleepAxisGate(view.get('sleep-se')!)) found.push(`${c.id} sleep ${x.gate}`)
  return found
}

/**
 * ★ THE DEBT, AS OF THIS SWEEP. ONE cell, and it is one this project made on purpose.
 *
 * It was four. `salma ne/contact-a` — the second TACTICAL GEAR, a large brown bundle in her
 * right hand in one frame of four, +24.3 % opaque area against a ±18 % tolerance and WORSE
 * than the 1.1855 that shipped the caption — was regenerated live for $0.0687 and is gone.
 * The refusal the ruling installed is what made that happen: `gen-cast-v5` stopped on her
 * three cached candidates instead of shipping the least-bad, `CAST_ATTEMPTS=6` drew a fourth,
 * and the fourth passed. Two cells of twenty-four moved; her ne stride trio still passes.
 *
 * `omar ne/contact-a` went the same way, for $0.2745 and three refusals — two of them BY EYE,
 * which is the control the eye is for. c3 cleared every gate with a contact frame no wider
 * than the idle (foot span 1.00x, against 1.21x for the cell it would have replaced): a walk
 * frame with no walk in it, and `strideGateV4` cannot see it because it measures frame-to-frame
 * pixel distance, not stance. c4 cleared every gate with a BAKED GROUND SHADOW under the boots
 * — Nadia's defect, the one this project has already proved no gate catches. c5 is clean on
 * both counts at 1.93x. Neither of those two properties is gated; see the report.
 */
export const KNOWN_GATE_DEBT: Record<string, string> = {
  // MINE, and named so it is not mistaken for the model's. The TACTICAL GEAR repair set
  // contact-b-ne := contact-a-ne — the last good frame of the same facing — so Amara's two
  // back-facing walk cycles have no alternating stride. Clears when the strip is redrawn.
  'amara ne stride contact-a~contact-b':
    '0.0000 against 0.1085 — the TACTICAL GEAR repair, by construction',

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

  it('★ and the debt is ONE cell, so a jump shows up in the diff', () => {
    expect(Object.keys(KNOWN_GATE_DEBT)).toHaveLength(1)
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
  //
  // Do not "fix" this by changing a tie-break: three candidate fixes were measured and none
  // moved the count (see the header). It needs an integer downscale factor, which is a
  // recalibration of every threshold in the cast pipeline, not a bug fix.
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


// ★ THE OTHER HALF OF "THE TWO GATES ASK THE SAME SET", stated as a number rather than left in
// prose: every committed sleeper lies along the ground diagonal, head up-right.
describe('every committed sleep cell lies along the ground, not across the screen', () => {
  it.each(cast.map((c) => [c.id, c] as const))('%s', async (id, c) => {
    const atlas = await decodePng(c.atlas)
    const deg = sleepAxisDeg(cropper(c, atlas)('sleep-se'))
    expect(deg, `${id} sleeps at ${deg.toFixed(1)} deg`).toBeGreaterThanOrEqual(-50)
    expect(deg, `${id} sleeps at ${deg.toFixed(1)} deg`).toBeLessThanOrEqual(-20)
  })
})
