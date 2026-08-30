import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ZOOM_STOPS } from './camera.js'
import { BUILDING_PX_PER_TILE } from './textures.js'

// A bilinear sample at any scale but 1.0 averages neighbouring texels, and the average of two
// palette members is not a palette member — so nothing may opt out of NEAREST.

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, '..')

/** One row of a paletted source, resampled to `outLen` under each filter. */
export function resampleRow(
  src: readonly number[],
  outLen: number,
  mode: 'nearest' | 'linear',
): number[] {
  const out: number[] = []
  for (let i = 0; i < outLen; i++) {
    const u = ((i + 0.5) * src.length) / outLen - 0.5
    if (mode === 'nearest') {
      out.push(src[Math.min(src.length - 1, Math.max(0, Math.round(u)))]!)
      continue
    }
    const lo = Math.min(src.length - 1, Math.max(0, Math.floor(u)))
    const hi = Math.min(src.length - 1, lo + 1)
    const f = Math.min(1, Math.max(0, u - lo))
    out.push(Math.round(src[lo]! * (1 - f) + src[hi]! * f))
  }
  return out
}

export function offPalette(row: readonly number[], palette: ReadonlySet<number>): number {
  return row.filter((v) => !palette.has(v)).length
}

/** A hi-res building cell as the forge ships it; a 1x1 footprint is drawn into 64px. */
const SOURCE_PX = 128
const drawnPx = (stop: number): number =>
  Math.max(1, Math.round(SOURCE_PX * (((1 + 1) * BUILDING_PX_PER_TILE) / SOURCE_PX) * stop))

// two MASTER_PALETTE members, as one channel each, alternating: the worst case for a blend
const A = 0x93,
  B = 0x43
const PALETTE = new Set([A, B])
const SRC = Array.from({ length: SOURCE_PX }, (_, i) => (i % 2 === 0 ? A : B))

describe('a bilinear sample invents colours the palette does not have', () => {
  it('produces off-palette values at every stop whose composite scale is not exactly 1', () => {
    const measured = ZOOM_STOPS.map((stop) => ({
      stop,
      scale: drawnPx(stop) / SOURCE_PX,
      off: offPalette(resampleRow(SRC, drawnPx(stop), 'linear'), PALETTE),
    }))
    // stated rather than hidden: bilinear IS the identity at exactly 1:1, and it is the only
    // scale in the whole set where the filter costs nothing.
    const blending = measured.filter((m) => m.scale !== 1)
    expect(blending.length, 'no stop blends — the fixture is wrong').toBeGreaterThan(0)
    for (const m of blending) expect(m.off, `stop ${m.stop} at scale ${m.scale}`).toBeGreaterThan(0)
    for (const m of measured.filter((x) => x.scale === 1)) expect(m.off, `stop ${m.stop}`).toBe(0)
  })

  it('and NEAREST produces none, at EVERY stop', () => {
    for (const stop of ZOOM_STOPS) {
      expect(offPalette(resampleRow(SRC, drawnPx(stop), 'nearest'), PALETTE), `stop ${stop}`).toBe(
        0,
      )
    }
  })
})

/** Every non-test source under `src`. */
function sources(dir = WEB_SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...sources(p))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
    out.push(p)
  }
  return out
}

/** `path:line — text` for every place that takes a texture off the NEAREST law. */
export function smoothingOffenders(files: readonly string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    src.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim()
      if (/scaleMode\s*[:=]\s*'linear'/.test(code) || /\bsmoothSource\b/.test(code)) {
        out.push(`${f.slice(WEB_SRC.length + 1)}:${i + 1} — ${code}`)
      }
    })
  }
  return out
}

describe('one filter for the whole town', () => {
  it('finds the sources it is meant to be scanning', () => {
    expect(sources().length).toBeGreaterThan(40)
  })

  // The sky ramp is a 1×64 gradient stretched over the whole town: at NEAREST it is 64 hard
  // bands, and it carries no art. The ONE exemption, named so a second cannot arrive quietly.
  it('leaves nothing but the sky ramp opted out of NEAREST', () => {
    expect(smoothingOffenders(sources()).map((o) => o.replace(/:\d+ —/, ' —'))).toEqual([
      "render/atmosphere.ts — tex.source.scaleMode = 'linear'",
    ])
  })

  it('still sets the global law in one place', () => {
    expect(readFileSync(join(WEB_SRC, 'render', 'scene.ts'), 'utf8')).toContain(
      "TextureSource.defaultOptions.scaleMode = 'nearest'",
    )
  })
})
