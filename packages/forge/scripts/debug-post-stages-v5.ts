// OFFLINE — zero API spend. Pipeline v5 CHECKPOINT harness: sw/idle + building-1 +
// nw/walk-a (worst v4 ambiguity). chromaKey → pitch-derived erode → refineLattice →
// driftField → ε-cluster resample → despeckle → fillPinholes → census magenta sweep →
// per-image color merge. Dumps every stage 1:1 + 4x, prints v4-vs-v5 metrics under
// BOTH dominance definitions (reconErr is the untouched arbiter). STOPS here.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import {
  erodeAlpha, estimatePitch, refineLattice, driftField, resampleModeLattice,
  resampleClusterLattice, mergeSheetColors, sweepMagentaCensus, despeckle, fillPinholes,
  anchorToCanvas, sheetMetrics,
} from '../src/sheet.js'

const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const STAGES = `${DURABLE}/pipeline-v5-stages`
const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'

function upscaleNearest(img: RawImage, k: number): RawImage {
  const out = new Uint8ClampedArray(img.width * k * img.height * k * 4)
  for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4
    out.set(img.data.subarray(s, s + 4), (y * img.width * k + x) * 4)
  }
  return { width: img.width * k, height: img.height * k, data: out }
}
async function dump(dir: string, name: string, img: RawImage) {
  writeFileSync(`${dir}/${name}.png`, await encodePng(img))
  writeFileSync(`${dir}/${name}-4x.png`, await encodePng(upscaleNearest(img, 4)))
  console.log(`  ${name}: ${img.width}x${img.height}`)
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

async function run(kind: string, rawPath: string, anchor: boolean) {
  const dir = `${STAGES}/${kind}`
  mkdirSync(dir, { recursive: true })
  console.log(`== ${kind} ==`)
  const keyed = chromaKey(await decodePng(readFileSync(rawPath)))
  const pitch = estimatePitch(keyed)
  const eroded = erodeAlpha(keyed, Math.max(1, Math.round(pitch / 2)))
  const b = bboxOf(eroded)
  const lat = refineLattice(eroded, pitch, { ox: b.x0, oy: b.y0 })
  console.log(`  pitch ${pitch.toFixed(2)}; lattice px=${lat.px.toFixed(2)} py=${lat.py.toFixed(2)}`)
  const drift = driftField(eroded, (lat.px + lat.py) / 2, { ox: lat.ox, oy: lat.oy })
  console.log(`  rowOffsets: ${drift.rowOffsets.join(',')}`)
  console.log(`  colOffsets: ${drift.colOffsets.join(',')}`)
  const c5 = resampleClusterLattice(eroded, lat, drift)
  await dump(dir, '01-resample-cluster', c5.out)
  const desp = despeckle(c5.out, 3)
  const filled = fillPinholes(desp, 2)
  await dump(dir, '02-hygiene', filled)
  const swept = sweepMagentaCensus(filled)
  await dump(dir, '03-census', swept)
  const [merged] = mergeSheetColors([swept], 6)
  await dump(dir, '04-merge', merged!)
  if (anchor) {
    await dump(dir, '05-anchor-merged', anchorToCanvas(merged!, 96, 96, 88))
    await dump(dir, '05b-anchor-nomerge', anchorToCanvas(swept, 96, 96, 88))
  }

  // metric table: both dominance definitions on both pipelines; reconErr is the arbiter
  const r4 = resampleModeLattice(eroded, lat)               // v4 native (bin + nudge)
  const c4 = resampleClusterLattice(eroded, lat)            // cluster-def on v4 windows
  const m5 = resampleModeLattice(eroded, lat, drift)        // bin-def on v5 windows
  const M = (e: { out: RawImage; dominance: Float32Array; origin: { i0: number; j0: number } }) =>
    sheetMetrics([{ out: e.out, dominance: e.dominance, eroded, lat, origin: e.origin }])
  const t = { v4bin: M(r4), v4cl: M(c4), v5bin: M(m5), v5cl: M(c5) }
  console.log('  pipeline/def   ambiguous%   dupRows   reconErr')
  console.log(`  v4 bin-def     ${t.v4bin.ambiguousPct.toFixed(1).padStart(8)}   ${String(t.v4bin.dupRowCount).padStart(7)}   ${t.v4bin.reconErr.toFixed(4)}`)
  console.log(`  v4 cluster-def ${t.v4cl.ambiguousPct.toFixed(1).padStart(8)}   ${String(t.v4cl.dupRowCount).padStart(7)}   ${t.v4cl.reconErr.toFixed(4)}`)
  console.log(`  v5 bin-def     ${t.v5bin.ambiguousPct.toFixed(1).padStart(8)}   ${String(t.v5bin.dupRowCount).padStart(7)}   ${t.v5bin.reconErr.toFixed(4)}`)
  console.log(`  v5 cluster-def ${t.v5cl.ambiguousPct.toFixed(1).padStart(8)}   ${String(t.v5cl.dupRowCount).padStart(7)}   ${t.v5cl.reconErr.toFixed(4)}`)
}

await run('cell', `${DURABLE}/character-sheet-v2/raws/idle-sw.png`, true)
await run('worst-cell', `${DURABLE}/character-sheet-v2/raws/walk-a-nw.png`, true)
await run('building', `${REF_CANDIDATES}/building-1.png`, false)
console.log(`stages in ${STAGES}/{cell,worst-cell,building}/ — CHECKPOINT: full rebuild awaits controller approval`)
