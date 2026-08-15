// OFFLINE — zero API spend. Pipeline v7 CHECKPOINT harness: sw/idle + nw/walk-a +
// building-1 ONLY. v6 chain output ("before") vs v6 + repairOutlineBlends ("after").
// Prints repaint counts and per-cell reconErr deltas (gate: worsening <= 0.002) and
// dumps tight before/after crops (1:1 + 4x) around the highest-repaint-density window.
// STOPS here — full rebuild awaits controller inspection.
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
  const { out: after, repainted } = repairOutlineBlends(before)

  const M = (out: RawImage) =>
    sheetMetrics([{ out, dominance: r.dominance, eroded, lat, origin: r.origin }])
  const m6 = M(before), m7 = M(after)
  const delta = m7.reconErr - m6.reconErr
  const gate = -delta >= -0.002 ? 'PASS' : '** FAIL **'
  console.log(`  pitch ${pitch.toFixed(2)}, art ${before.width}x${before.height}`)
  console.log(`  repainted ${repainted} (${(100 * repainted / (before.width * before.height)).toFixed(2)}% of frame)`)
  console.log(`  reconErr v6 ${m6.reconErr.toFixed(4)} -> v7 ${m7.reconErr.toFixed(4)}  delta(v7-v6) ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}  gate(<=+0.002) ${gate}`)

  // highest-repaint-density window: 16x16 (clamped) maximizing repaint count
  const coords: [number, number][] = []
  for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
    const i = (y * before.width + x) * 4
    if (before.data[i] !== after.data[i] || before.data[i + 1] !== after.data[i + 1] || before.data[i + 2] !== after.data[i + 2])
      coords.push([x, y])
  }
  const W = Math.min(16, before.width), H = Math.min(16, before.height)
  let bx = 0, by = 0, bn = -1
  for (let y0 = 0; y0 <= before.height - H; y0++) for (let x0 = 0; x0 <= before.width - W; x0++) {
    const n = coords.filter(([x, y]) => x >= x0 && x < x0 + W && y >= y0 && y < y0 + H).length
    if (n > bn) { bn = n; bx = x0; by = y0 }
  }
  console.log(`  densest ${W}x${H} window at (${bx},${by}): ${Math.max(bn, 0)} repaints`)
  await dump(dir, 'before-full', before)
  await dump(dir, 'after-full', after)
  await dump(dir, `before-crop-${bx}-${by}`, cropRect(before, bx, by, W, H))
  await dump(dir, `after-crop-${bx}-${by}`, cropRect(after, bx, by, W, H))
  return { kind, repainted, v6: m6.reconErr, v7: m7.reconErr, delta }
}

const results = [
  await run('cell', `${DURABLE}/character-sheet-v2/raws/idle-sw.png`),
  await run('worst-cell', `${DURABLE}/character-sheet-v2/raws/walk-a-nw.png`),
  await run('building', `${REF_CANDIDATES}/building-1.png`),
]
console.log('\nsummary (image / repaints / reconErr v6 -> v7 / delta):')
for (const r of results)
  console.log(`  ${r.kind.padEnd(11)} ${String(r.repainted).padStart(4)}  ${r.v6.toFixed(4)} -> ${r.v7.toFixed(4)}  ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(4)}`)
console.log(`crops in ${STAGES}/{cell,worst-cell,building}/ — CHECKPOINT: full rebuild awaits controller inspection`)
