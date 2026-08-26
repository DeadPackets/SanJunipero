// OFFLINE, $0.00 — re-quantize every shipped portrait onto the DERIVED RAMPS. Extra tones are
// allowed only where they interpolate between existing MASTER_PALETTE members.
// Reports HAIR and SKIN tone counts before and after: a collapse stops the class.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { quantize } from '../src/post/quantize.js'
import { paletteRgb } from '../src/palette.js'
import { paletteGate } from '../src/pixelGates.js'
import { derivedPalette, onARamp, RAMP_STEPS } from '../src/ramps.js'
import { upscaleNearest } from '../src/sheet.js'
import { scratch } from './scratch.js'

const S = scratch()

const OUT = `${S}/fqc2/portraits`

// Where each cast member's shipped busts live.
const CASTS = [
  { id: 'omar', dir: `${S}/c5/portraits/final` },
  { id: 'amara', dir: `${S}/c5/production/amara/portraits/final` },
  { id: 'yusuf', dir: `${S}/c5/production/yusuf/portraits/final` },
  { id: 'nadia', dir: `${S}/c5/production/nadia/portraits/final` },
  { id: 'salma', dir: `${S}/c5/production/salma/portraits/final` },
]

// HAIR is the top band of the bust, SKIN the middle: no segmentation model, just the two
// horizontal bands a 128 px head portrait puts them in. Counting distinct opaque tones in a
// band is the measurement the ruling asked for — "how many tones does the hair still have".
const BANDS = { hair: [0.06, 0.30], skin: [0.36, 0.62] } as const

function bandTones(img: RawImage, band: readonly [number, number]): number {
  const y0 = Math.round(img.height * band[0]), y1 = Math.round(img.height * band[1])
  const s = new Set<number>()
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4
    if (img.data[i + 3] === 0) continue
    s.add((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!)
  }
  return s.size
}

const derived = derivedPalette()
console.log(`master palette ${paletteRgb().length} colours → derived ramps ${derived.length} `
  + `(RAMP_STEPS=${RAMP_STEPS}, every added tone interpolated inside one ramp)`)

type Row = { who: string; expr: string; hairBefore: number; hairMaster: number; hairAfter: number
  skinBefore: number; skinMaster: number; skinAfter: number; off: number }
const rows: Row[] = []
const refused: string[] = []

for (const c of CASTS) {
  if (!existsSync(c.dir)) { console.log(`${c.id}: no portraits at ${c.dir}`); continue }
  const dest = join(OUT, c.id)
  mkdirSync(dest, { recursive: true })
  for (const f of readdirSync(c.dir).filter((n) => n.endsWith('.png') && !n.includes('-4x')).sort()) {
    const shipped = await decodePng(readFileSync(join(c.dir, f)))
    const master = quantize(shipped, paletteRgb())
    const ramped = quantize(shipped, derived)
    // quantize zeroes the RGB of clear pixels; the cut-out itself is unchanged
    for (let i = 3; i < ramped.data.length; i += 4) ramped.data[i] = shipped.data[i]!
    for (let i = 3; i < master.data.length; i += 4) master.data[i] = shipped.data[i]!

    const g = paletteGate(ramped, { palette: derived })
    rows.push({
      who: c.id, expr: f.replace('.png', ''),
      hairBefore: bandTones(shipped, BANDS.hair), hairMaster: bandTones(master, BANDS.hair),
      hairAfter: bandTones(ramped, BANDS.hair),
      skinBefore: bandTones(shipped, BANDS.skin), skinMaster: bandTones(master, BANDS.skin),
      skinAfter: bandTones(ramped, BANDS.skin),
      off: g.offPalette,
    })
    // ★ `paletteGate`'s verdict went into a table column and the portrait was written
    // whatever it said. The whole point of this script is to land every pixel on a derived
    // ramp, so an off-ramp pixel is the one failure it cannot ship.
    if (!g.ok) { refused.push(`${c.id}/${f}: ${g.failures.join('; ')}`); continue }
    writeFileSync(join(dest, f), await encodePng(ramped))
    writeFileSync(join(dest, f.replace('.png', '-4x.png')), await encodePng(upscaleNearest(ramped, 4)))
    cpSync(join(c.dir, f), join(dest, `before-${f}`))
  }
}

// every derived tone must actually be ON a ramp — the ruling, checked rather than asserted
const strays = derived.filter((t) => !onARamp(t))
const md = [
  '# portraits, re-quantized onto DERIVED RAMPS (user ruling 2026-08-18)',
  '',
  `master palette **${paletteRgb().length}** colours → derived ramps **${derived.length}**, `
  + `every added tone interpolated between two ADJACENT members of the same ramp `
  + `(RAMP_STEPS=${RAMP_STEPS}). Tones that are not on a ramp: **${strays.length}**.`,
  '',
  'Tone counts are distinct opaque colours in a horizontal band of the bust — hair the top',
  'quarter, skin the middle. "master" is what the blanket-exemption alternative would have',
  'shipped: snapping to the world\'s forty.',
  '',
  '| who | expression | hair: shipped → master → ramps | skin: shipped → master → ramps | off-palette after |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.who} | ${r.expr} | ${r.hairBefore} → ${r.hairMaster} → **${r.hairAfter}** `
    + `| ${r.skinBefore} → ${r.skinMaster} → **${r.skinAfter}** | ${r.off} |`),
]
const mean = (f: (r: Row) => number): string => (rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(1)
md.push('', `**mean hair** ${mean((r) => r.hairBefore)} → ${mean((r) => r.hairMaster)} → **${mean((r) => r.hairAfter)}**`
  + `  ·  **mean skin** ${mean((r) => r.skinBefore)} → ${mean((r) => r.skinMaster)} → **${mean((r) => r.skinAfter)}**`)
mkdirSync(`${S}/fqc2/reports`, { recursive: true })
writeFileSync(`${S}/fqc2/reports/portraits.md`, md.join('\n'))
console.log(`\n${md.join('\n')}`)

// Report first, then the wall — the table is what says whether the ramps or the art are wrong.
if (refused.length > 0) throw new Error(
  `${refused.length} portrait(s) landed OFF the derived ramps and were not written:\n    `
  + `${refused.join('\n    ')}\n  The report is at ${S}/fqc2/reports/portraits.md.`)
