// OFFLINE — zero API spend. Pipeline v7 CHECKPOINT harness (t>=0.4 rerun): sw/idle +
// nw/walk-a + building-1 ONLY. v6 chain output ("before") vs v6 + repairOutlineBlends.
// Gate (controller ruling): reconErr EXCLUDING repainted pixels within +/-0.0005 of v6
// on the same mask — proves zero collateral damage; total reconErr is informational.
// Crops fixed to the regions the controller inspected. STOPS here.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  erodeAlpha, estimatePitch, refineLattice, resampleClusterLattice, despeckle,
  fillPinholes, sweepMagentaCensus, repairOutlineBlends, sheetMetrics,
} from '../src/sheet.js'

const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const STAGES = `${DURABLE}/pipeline-v7-stages`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'

function upscaleNearest(img: RawImage, k: number): RawImage {
  const out = new Uint8ClampedArray(img.width * k * img.height * k * 4)
  for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4
    out.set(img.data.subarray(s, s + 4), (y * img.width * k + x) * 4)
  }
  return { width: img.width * k, height: img.height * k, data: out }
}
function cropRect(img: RawImage, x0: number, y0: number, w: number, h: number): RawImage {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * img.width + x0) * 4
    out.set(img.data.subarray(s, s + w * 4), y * w * 4)
  }
  return { width: w, height: h, data: out }
}
async function dump(dir: string, name: string, img: RawImage) {
  writeFileSync(`${dir}/${name}.png`, await encodePng(img))
  writeFileSync(`${dir}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
}
const bboxOf = (img: RawImage) => {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++)
    if (img.data[(y * img.width + x) * 4 + 3]! > 0) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return { x0, x1, y0, y1 }
}

// same regions the controller inspected on the first checkpoint
const FIXED_CROPS: Record<string, [number, number]> = { cell: [20, 29], 'worst-cell': [24, 1], building: [21, 80] }

async function run(kind: string, rawPath: string) {
  const dir = `${STAGES}/${kind}`
  mkdirSync(dir, { recursive: true })
  console.log(`== ${kind} ==`)
  const keyed = chromaKey(await decodePng(readFileSync(rawPath)))
  const pitch = estimatePitch(keyed)
  const eroded = erodeAlpha(keyed, Math.max(1, Math.round(pitch / 2)))
  const b = bboxOf(eroded)
  const lat = refineLattice(eroded, pitch, { ox: b.x0, oy: b.y0 })
  const r = resampleClusterLattice(eroded, lat)
  const before = sweepMagentaCensus(fillPinholes(despeckle(r.out, 3), 2)) // = v6 output
  const { out: after, repainted, outlineSnaps, fillSnaps } = repairOutlineBlends(before)

  const M = (out: RawImage) =>
    sheetMetrics([{ out, dominance: r.dominance, eroded, lat, origin: r.origin }])
  const m6 = M(before), m7 = M(after)
  const delta = m7.reconErr - m6.reconErr

  const coords: [number, number][] = []
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    const i = (y * before.width + x) * 4
    if (before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] || before.data[i + 2] !== after.data[i + 2])
      coords.push([x, y])
  }
  // exclusion gate: alpha-out the repainted pixels in BOTH images, recompute reconErr
  const masked = (img: RawImage) => {
    const data = new Uint8ClampedArray(img.data)
    for (const [x, y] of coords) data[(y * img.width + x) * 4 + 3] = 0
    return { width: img.width, height: img.height, data }
  }
  const e6 = M(masked(before)).reconErr, e7 = M(masked(after)).reconErr
  const exclDelta = e7 - e6
  const gate = Math.abs(exclDelta) <= 0.0005 ? 'PASS' : '** FAIL **'
  console.log(`  pitch ${pitch.toFixed(2)}, art ${before.width}x${before.height}`)
  console.log(`  repainted ${repainted} = ${outlineSnaps} outline-snaps + ${fillSnaps} fill-snaps (${(100 * repainted / (before.width * before.height)).toFixed(2)}% of frame)`)
  console.log(`  reconErr total v6 ${m6.reconErr.toFixed(4)} -> v7 ${m7.reconErr.toFixed(4)} (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}, informational)`)
  console.log(`  reconErr excl-repaints v6 ${e6.toFixed(4)} -> v7 ${e7.toFixed(4)}  delta ${exclDelta >= 0 ? '+' : ''}${exclDelta.toFixed(5)}  gate(+/-0.0005) ${gate}`)
  const W = Math.min(16, before.width), H = Math.min(16, before.height)
  const [bx, by] = FIXED_CROPS[kind]!
  const inWin = coords.filter(([x, y]) => x >= bx && x < bx + W && y >= by && y < by + H).length
  console.log(`  fixed ${W}x${H} window at (${bx},${by}): ${inWin} repaints`)
  await dump(dir, 'before-full', before)
  await dump(dir, 'after-full', after)
  await dump(dir, `before-crop-${bx}-${by}`, cropRect(before, bx, by, W, H))
  await dump(dir, `after-crop-${bx}-${by}`, cropRect(after, bx, by, W, H))
  return { kind, repainted, outlineSnaps, fillSnaps, v6: m6.reconErr, v7: m7.reconErr, delta, exclDelta }
}

const results = [
  await run('cell', `${DURABLE}/character-sheet-v2/raws/idle-sw.png`),
  await run('worst-cell', `${DURABLE}/character-sheet-v2/raws/walk-a-nw.png`),
  await run('building', `${REF_CANDIDATES}/building-1.png`),
]
console.log('\nsummary (image / outline-snaps / fill-snaps / excl-gate delta / total reconErr v6 -> v7):')
for (const r of results)
  console.log(`  ${r.kind.padEnd(11)} ${String(r.outlineSnaps).padStart(4)}  ${String(r.fillSnaps).padStart(4)}  ${r.exclDelta >= 0 ? '+' : ''}${r.exclDelta.toFixed(5)}  ${r.v6.toFixed(4)} -> ${r.v7.toFixed(4)} (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(4)})`)
console.log(`crops in ${STAGES}/{cell,worst-cell,building}/ — CHECKPOINT: full rebuild awaits controller inspection`)
