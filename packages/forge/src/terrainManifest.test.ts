import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TilesetManifest, loadTilesetManifest } from './terrainManifest.js'

const names16 = Array.from({ length: 16 }, (_, i) => `tile-${i}`)
const manifest = {
  tileW: 32, tileH: 16, cols: 4, rows: 4,
  seasons: Object.fromEntries((['spring', 'summer', 'autumn', 'winter'] as const)
    .map(s => [s, { file: `${s}.png`, tiles: names16 }])),
  scaffolding: { file: 'scaffolding.png' },
}

describe('TilesetManifest', () => {
  it('accepts the 4-season 32x16 shape and rejects a missing season', () => {
    expect(TilesetManifest.parse(manifest).tileW).toBe(32)
    const { winter: _drop, ...three } = manifest.seasons as Record<string, unknown>
    expect(() => TilesetManifest.parse({ ...manifest, seasons: three })).toThrow()
  })
})

describe('loadTilesetManifest', () => {
  it('loads and verifies every referenced file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-tiles-'))
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
      for (const f of ['spring.png', 'summer.png', 'autumn.png', 'winter.png', 'scaffolding.png'])
        writeFileSync(join(dir, f), Buffer.from('png'))
      expect(loadTilesetManifest(dir).scaffolding.file).toBe('scaffolding.png')
      rmSync(join(dir, 'winter.png'))
      expect(() => loadTilesetManifest(dir)).toThrow(/winter\.png/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
