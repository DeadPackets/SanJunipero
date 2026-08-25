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
// ★ THE MIRROR ASYMMETRY IS FIXED, AND THE CAUSE THIS FILE RECORDED WAS WRONG TWICE OVER.
//
// What it said: `frameCoherenceGate` returns different verdicts for `se` and its exact flip
// `sw` on 3 of 10 pairs; the cause is majority downscale at a NON-INTEGER factor, which "no
// tie-break rule reaches"; three candidate fixes were measured and none moved the count.
//
// Both halves of that are wrong, and the second is why the first was believed.
//
//  1. THE INSTRUMENT WAS WRONG. The three candidates were judged on `gateView(flip)` vs
//     `flip(gateView)` in PIXELS — ~30 000 of them, which barely moved. That number is
//     dominated by `anchorToCanvas` centring an odd-width bbox on an even-width canvas: a
//     one-column TRANSLATION, which cannot change a histogram and so cannot change a palette
//     or a silhouette verdict. Measure the downscale on its own and it is 7 313 px.
//  2. A SYMMETRIC PARTITION REACHES IT EXACTLY. `floor(i*src/n)` boxes are not their own
//     mirror; boundaries built so that box(n-1-i) reflects box(i) are, and with an
//     order-independent tie-break the reduction commutes with a flip to the byte:
//
//       downscale(flip) vs flip(downscale)     7 313 px  ->  0 px
//       frameCoherenceGate verdicts disagree      3/10   ->  0/10
//
//     The one place a symmetric partition does not exist — even output width over an odd
//     source, where there is no centre boundary on the grid — the centre column votes in both
//     middle boxes. `headRegionDiff` needed the other half: two bboxes of different width
//     parity are half a column apart, so it aligns their centres in HALF pixels now.
//
// ★ WHAT IT COST, BECAUSE IT WAS NOT FREE: `omar se/contact-a` went 0.8125 -> 0.6875 on
// palette and is pinned below. It is not that the art changed. `paletteJaccard` counts
// clusters over a 1 % floor after a 10.6x majority downscale, and measured across the whole
// committed cast a MEAN OF 12.1 of the ~13-17 deciding clusters per verdict sit within 2x of
// that floor. omar's cell was passing at 13/16 — one cluster over the 0.80 bar — and its own
// mirror already read 0.6875 under the shipped gate. Three of the four samplings of that art
// say 0.6875; the audit was reading the fourth.
//
// A weighted (Ruzicka) palette agreement with no floor at all was measured as the way out and
// REFUSED: over the 100 committed pairs plus four known-bad cells out of git history, clean
// art spans 0.599-0.898 and the TACTICAL GEAR cell scores 0.898 — above 46 of the clean ones.
// Not weak, inverted, same as the baked-shadow metric. No threshold exists. See the report.
//
// ONLY THE AUTHORED FACINGS ARE STILL JUDGED, now for the only reason that was ever good:
// `deriveSheet` builds `sw` as `mirrorX(se)` and the test below asserts the two are identical
// to the pixel, so a derived verdict is the authored art measured twice. What changed is that
// it is no longer measured twice through a lens that answers differently.
//
// THIS FILE PINS THE DEBT, IT DOES NOT BLESS IT. Every entry is a cell that would not pass
// today. Fixing one turns this red, which is the point: the list may only get shorter, and it
// may never get longer without somebody writing the reason down.
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import {
  CELL_V2, FEET_Y_V2, POSES_V2, FACINGS, anchorToCanvas, cellDistance, downscaleMajority,
  frameCoherenceGate, headRegionDiff, mirrorX, opaqueArea, opaqueBbox, paletteJaccard, sleepGate,
} from './sheet.js'
import { sleepAxisDeg, sleepAxisGate, strideGateV4 } from './mirror.js'
import { alphaBinaryGate, paletteGate, soleSilhouetteGate } from './pixelGates.js'
import { listCommittedCast, type CommittedCharacter } from './castArt.js'

const MAX_ART_H = FEET_Y_V2 + 1
const CALIBRATED_MEDIAN = 0.310
const AUTHORED = ['se', 'ne'] as const
const WALK = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const

function fitForGate(img: RawImage): RawImage {
  const k = Math.min(MAX_ART_H / img.height, CELL_V2 / img.width, 1)
  return k === 1 ? img : downscaleMajority(img,
    Math.min(CELL_V2, Math.max(1, Math.round(img.width * k))),
    Math.min(MAX_ART_H, Math.max(1, Math.round(img.height * k))))
}
const gateView = (img: RawImage): RawImage =>
  anchorToCanvas(fitForGate(img), CELL_V2, CELL_V2, FEET_Y_V2)

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

  // ★ THE RULER MOVED, NOT THE ART — the only entry here that is not a drawing defect, and
  // it is written down rather than absorbed because that is what this list is for. See the
  // header: this cell measured 0.8125 through a partition that answered differently on its
  // own mirror, which read 0.6875. The gate is consistent now and reads 0.6875 in both.
  // Clearing it means redrawing omar's se/contact-a, which also carries head 0.1871 against
  // a 0.20 bar — the cell is marginal on two terms, and a lane that regenerates it must
  // watch both.
  'omar se palette contact-a':
    '0.6875 against 0.8000 — one palette cluster of sixteen, exposed by the mirror fix',
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

  it('★ and the debt is TWO cells, so a jump shows up in the diff', () => {
    expect(Object.keys(KNOWN_GATE_DEBT)).toHaveLength(2)
  })
})

// ★ THE REASON THE SWEEP JUDGES ONLY THE AUTHORED FACINGS, asserted rather than left in prose.
describe('the derived facings are exact mirrors, and the gate now agrees across them', () => {
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

  // ★ THIS USED TO ASSERT THE OPPOSITE. It was written to red the day `gateView` was made
  // mirror-safe, so that the sweep could be widened; that day is this commit. It now pins the
  // property, to the sixth decimal of every measured VALUE rather than to the verdict — a
  // verdict-level check would go on passing while the numbers drifted right up to a
  // threshold, which is how the defect hid in the first place.
  it('★ every measured value is identical on a facing and on its mirror', async () => {
    const disagreements: string[] = []
    for (const c of cast) {
      const crop = cropper(c, await decodePng(c.atlas))
      // every term of every frame, not only the ones over threshold: a verdict-level check
      // goes on passing while the numbers drift up to the bar, which is how this hid.
      const values = (f: string): string => {
        const idle = gateView(crop(`idle-${f}`)), ia = opaqueArea(idle)
        return WALK.map((p) => {
          const x = gateView(crop(`${p}-${f}`))
          return `${p} ${paletteJaccard(idle, x).toFixed(6)} ${(opaqueArea(x) / ia).toFixed(6)} `
            + `${headRegionDiff(idle, x).toFixed(6)}`
        }).join(' | ')
      }
      for (const [authored, derived] of [['se', 'sw'], ['ne', 'nw']] as const)
        if (values(authored) !== values(derived))
          disagreements.push(`${c.id}\n  ${authored} ${values(authored)}\n  ${derived} ${values(derived)}`)
    }
    expect(disagreements, 'the gate answers differently on the same pixels flipped').toEqual([])
  })

  // ★ AND THE ONE PIECE THAT CANNOT BE FIXED, measured rather than assumed, so nobody spends
  // a lane on it. `anchorToCanvas` centres an opaque bbox on a 96-wide canvas. An ODD bbox
  // width has no placement that is its own mirror, so the sprite lands one column off between
  // an image and its flip — irreducible on an integer grid, not a rounding choice. Palette,
  // silhouette and head do not care: the first two are histograms and the third re-derives
  // the bbox. `cellDistance` does, which is why `strideGateV4` stays authored-facings-only.
  it('the residual is the anchor, it is exactly one column, and only cellDistance sees it', async () => {
    const crop = cropper(cast[0]!, await decodePng(cast[0]!.atlas))
    let odd = 0
    for (const p of ['idle', ...WALK]) {
      const fitted = fitForGate(crop(`${p}-se`))
      const b = opaqueBbox(fitted)!
      if ((b.x1 - b.x0 + 1) % 2 === 0) continue
      odd++
      const lhs = anchorToCanvas(mirrorX(fitted), CELL_V2, CELL_V2, FEET_Y_V2)
      const rhs = mirrorX(anchorToCanvas(fitted, CELL_V2, CELL_V2, FEET_Y_V2))
      expect(Math.abs(opaqueBbox(lhs)!.x0 - opaqueBbox(rhs)!.x0),
        'the anchor is off by more than one column').toBe(1)
      // and the terms that do not care, do not care
      expect(opaqueArea(lhs)).toBe(opaqueArea(rhs))
      expect(paletteJaccard(lhs, rhs)).toBe(1)
      expect(headRegionDiff(lhs, rhs)).toBe(0)
      expect(cellDistance(lhs, rhs), 'cellDistance would not see the shift').toBeGreaterThan(0)
    }
    expect(odd, 'no odd-width bbox in this sheet — the residual is unexercised').toBeGreaterThan(0)
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
