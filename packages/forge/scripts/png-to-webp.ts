// OFFLINE, $0. Re-encodes every shipped PNG as LOSSLESS WebP, proves not one visible pixel moved,
// and deletes the PNG it replaces. Idempotent: a converted tree converts nothing.
// `content/reference/` is excluded — those three photographic plates get 24% BIGGER as lossless
// WebP, and they are prompt anchors sent to the image vendor, never served.
import { globSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REFERENCE_CONTENT_DIR } from '../src/buildingArt.js'
import { UI_PX_DIR } from '../src/uiAssets.js'
import { decodePng, encodeWebp, visiblePixelDiffs } from '../src/post/raw.js'

const CONTENT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'content')

const SETS: Record<string, string> = {
  content: join(CONTENT, '**', '*.png'),
  'web px': join(UI_PX_DIR, '*.png'),
}

const mb = (n: number): string => `${(n / 1e6).toFixed(2)} MB`
const pct = (from: number, to: number): string =>
  from === 0 ? '—' : `${(((to - from) / from) * 100).toFixed(0)}%`

let totalPng = 0,
  totalWebp = 0,
  totalDiffs = 0

console.log('| set | n | png | webp | Δ | visible pixel diffs |')
console.log('|---|---:|---:|---:|---:|---:|')
for (const [name, pattern] of Object.entries(SETS)) {
  const files = globSync(pattern)
    .filter((f) => !f.startsWith(REFERENCE_CONTENT_DIR))
    .sort()
  let png = 0,
    webp = 0,
    diffs = 0
  for (const file of files) {
    const before = readFileSync(file)
    const source = await decodePng(before)
    const out = await encodeWebp(source)
    diffs += visiblePixelDiffs(source, await decodePng(out))
    writeFileSync(file.replace(/\.png$/, '.webp'), out)
    rmSync(file)
    png += before.length
    webp += out.length
  }
  totalPng += png
  totalWebp += webp
  totalDiffs += diffs
  console.log(
    `| ${name} | ${files.length} | ${mb(png)} | ${mb(webp)} | ${pct(png, webp)} | ${diffs} |`,
  )
}
console.log(
  `| **all** | | **${mb(totalPng)}** | **${mb(totalWebp)}** | ` +
    `**${pct(totalPng, totalWebp)}** | **${totalDiffs}** |`,
)
if (totalDiffs > 0)
  throw new Error(`${totalDiffs} visible pixels changed — the art is NOT lossless`)
