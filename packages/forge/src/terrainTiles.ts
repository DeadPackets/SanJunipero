import {
  ROAD_AUTOTILE_KEYS,
  SEASONS,
  TERRAIN_TILE_KINDS,
  roadAutotileKind,
  type AssetRecord,
  type Season,
  type TerrainTileKind,
} from '@sj/shared'
import { paletteRgb } from './palette.js'
import type { RawImage } from './post/raw.js'
import { encodePng } from './post/raw.js'
import { applyTint, type Tint } from './tints.js'
import { paintRoadAutotile } from './roadTiles.js'
import type { AssetCodex } from './codex.js'

export const TERRAIN_TILE_W = 32,
  TERRAIN_TILE_H = 16 // base tile diamond (Style Bible grid)
export const TERRAIN_VARIANTS = 4

// Every hex is a MASTER_PALETTE member — paintTerrainTile resolves through the palette and
// throws on a stranger, so the palette law cannot rot silently.
export const TERRAIN_COLORS: Record<
  TerrainTileKind,
  { base: number; light: number; dark: number; speck: number }
> = {
  grass: { base: 0x93b573, light: 0xb9d19a, dark: 0x6f9455, speck: 0x4f7040 },
  earth: { base: 0xc68a48, light: 0xe0a95e, dark: 0xa66e38, speck: 0x7e512b },
  water: { base: 0x7fb0c9, light: 0xa8cfe0, dark: 0x5a8cab, speck: 0xd6eaf2 },
  // the sage ramp bottoms out at the forest base, so the rim borrows the shadow ramp
  forest: { base: 0x4f7040, light: 0x6f9455, dark: 0x43394a, speck: 0x93b573 },
  rock: { base: 0xaba198, light: 0xcfc6bc, dark: 0x857d75, speck: 0x5d5751 },
  sand: { base: 0xe8d5bc, light: 0xf6e8d5, dark: 0xd4bc9e, speck: 0xb89d7e },
  farmland: { base: 0xa66e38, light: 0xc68a48, dark: 0x7e512b, speck: 0x6f9455 },
  road: { base: 0xd4bc9e, light: 0xe8d5bc, dark: 0xb89d7e, speck: 0x857d75 }, // packed stone, distinct from grass/dirt
}

export const TERRAIN_RIM = 0.82 // normalised diamond distance where the rim shade starts
export const TERRAIN_SPECKS = 7 // speck candidates per tile; the ones outside the core are dropped
export const TERRAIN_SPECK_CORE = 0.6 // specks only land inside this much of the diamond

// The classic 32×16 dimetric diamond: row 0 is 4px wide and each row grows by 4 to the full
// 32 at rows 7/8, so the four edge midpoints (16,0) (16,15) (0,7) (31,7) are all opaque.
export function tileRowHalfWidth(y: number): number {
  return 2 * ((y < TERRAIN_TILE_H / 2 ? y : TERRAIN_TILE_H - 1 - y) + 1)
}

export function inTileDiamond(x: number, y: number): boolean {
  if (y < 0 || y >= TERRAIN_TILE_H) return false
  const half = tileRowHalfWidth(y)
  return x >= TERRAIN_TILE_W / 2 - half && x < TERRAIN_TILE_W / 2 + half
}

// 0 at the tile centre, ~1.03 at the extreme corners — drives the rim shade and the speck core.
function radial(x: number, y: number): number {
  return (
    Math.abs(x + 0.5 - TERRAIN_TILE_W / 2) / (TERRAIN_TILE_W / 2) +
    Math.abs(y + 0.5 - TERRAIN_TILE_H / 2) / (TERRAIN_TILE_H / 2)
  )
}

// one dimetric diamond top-face; NW-light edge: upper-left lit, lower-right shaded
export function paintTerrainTile(kind: TerrainTileKind, variant: number): RawImage {
  const pal = paletteRgb()
  const { base, light, dark, speck } = TERRAIN_COLORS[kind]
  const data = new Uint8ClampedArray(TERRAIN_TILE_W * TERRAIN_TILE_H * 4)
  const put = (x: number, y: number, hex: number): void => {
    const c = pal.find((p) => ((p[0] << 16) | (p[1] << 8) | p[2]) === hex)
    if (c === undefined)
      throw new Error(`terrain colour #${hex.toString(16)} is not a MASTER_PALETTE member`)
    data.set([c[0], c[1], c[2], 255], (y * TERRAIN_TILE_W + x) * 4)
  }
  for (let y = 0; y < TERRAIN_TILE_H; y++) {
    for (let x = 0; x < TERRAIN_TILE_W; x++) {
      if (!inTileDiamond(x, y)) continue
      const rim = radial(x, y) > TERRAIN_RIM
      put(x, y, rim ? dark : x < TERRAIN_TILE_W / 2 && y < TERRAIN_TILE_H / 2 ? light : base)
    }
  }
  for (let i = 0; i < TERRAIN_SPECKS; i++) {
    // variant-seeded speckle (deterministic)
    const sx = 4 + ((variant * 7 + i * 5) % (TERRAIN_TILE_W - 8))
    const sy = 3 + ((variant * 3 + i * 11) % (TERRAIN_TILE_H - 6))
    if (radial(sx, sy) <= TERRAIN_SPECK_CORE) put(sx, sy, speck)
  }
  return { width: TERRAIN_TILE_W, height: TERRAIN_TILE_H, data }
}

const terrainMeta = (kind: TerrainTileKind, variant: number): string =>
  JSON.stringify({
    version: 'v1-terrain-tile',
    kind,
    variant,
    wPx: TERRAIN_TILE_W,
    hPx: TERRAIN_TILE_H,
  })

// The manifest kind stays the flat `road` (the strip is road art, autotiled); the codex KIND
// carries the shape, which is what `resolveTerrainTile` looks up.
export async function registerRoadAutotiles(codex: AssetCodex): Promise<AssetRecord[]> {
  const out: AssetRecord[] = []
  for (const key of ROAD_AUTOTILE_KEYS) {
    const png = await encodePng(paintRoadAutotile(key))
    out.push(
      codex.register({
        class: 'terrain',
        desc: `road tile: ${key}`,
        kind: roadAutotileKind(key),
        meta: terrainMeta('road', 0),
        footprint: { w: 1, h: 1 },
        png,
        widthPx: TERRAIN_TILE_W,
        heightPx: TERRAIN_TILE_H,
        status: 'ready',
        score: 10,
        attempts: 1,
        costUsd: 0,
      }),
    )
  }
  return out
}

// ingest exactly like buildings: class 'terrain', kind = tile kind, meta = manifest JSON
export async function registerTerrainTiles(codex: AssetCodex): Promise<AssetRecord[]> {
  const out: AssetRecord[] = []
  for (const kind of TERRAIN_TILE_KINDS) {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant++) {
      const png = await encodePng(paintTerrainTile(kind, variant))
      out.push(
        codex.register({
          class: 'terrain',
          desc: `tile: ${kind}`,
          kind,
          meta: terrainMeta(kind, variant),
          footprint: { w: 1, h: 1 },
          png,
          widthPx: TERRAIN_TILE_W,
          heightPx: TERRAIN_TILE_H,
          status: 'ready',
          score: 10,
          attempts: 1,
          costUsd: 0,
        }),
      )
    }
  }
  out.push(...(await registerRoadAutotiles(codex)))
  return out
}

// ------------------------------------------------------------------ seasonal 4×4 sheets

// The manifest sheet is 4 cols × 4 rows of 32×16 tiles: four ground kinds × four variants,
// in the order the C5 tileset contract named them (grass, path, water edge, rock).
export const SHEET_COLS = 4,
  SHEET_ROWS = 4
export const SHEET_KINDS: readonly TerrainTileKind[] = ['grass', 'road', 'water', 'rock']

export function seasonTileNames(): string[] {
  return SHEET_KINDS.flatMap((kind) =>
    Array.from({ length: TERRAIN_VARIANTS }, (_, v) => `${kind}-${v}`),
  )
}

// The tint is the last thing the sheet gets and nothing quantizes after it, so a tinted tile
// keeps the colour the tint gave it.
export const SEASON_TINTS: Record<Season, Tint> = {
  spring: { r: 0.9, g: 1.12, b: 0.9 },
  summer: { r: 1.0, g: 1.0, b: 1.0 },
  autumn: { r: 1.1, g: 0.94, b: 0.8 },
  winter: { r: 0.86, g: 0.93, b: 1.1 },
}

export function paintSeasonSheet(season: Season): RawImage {
  const width = SHEET_COLS * TERRAIN_TILE_W,
    height = SHEET_ROWS * TERRAIN_TILE_H
  const sheet: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  SHEET_KINDS.forEach((kind, row) => {
    for (let col = 0; col < TERRAIN_VARIANTS; col++) {
      const tile = paintTerrainTile(kind, col)
      for (let y = 0; y < TERRAIN_TILE_H; y++) {
        const src = tile.data.subarray(y * TERRAIN_TILE_W * 4, (y + 1) * TERRAIN_TILE_W * 4)
        sheet.data.set(src, ((row * TERRAIN_TILE_H + y) * width + col * TERRAIN_TILE_W) * 4)
      }
    }
  })
  return applyTint(sheet, SEASON_TINTS[season])
}

export const SCAFFOLD_W = 32,
  SCAFFOLD_H = 32
export const SCAFFOLD_POST = 0xa66e38,
  SCAFFOLD_BRACE = 0x7e512b // honey-wood ramp

// A bare timber frame — two posts, two rails, one diagonal brace. Buildings wear it until
// they are complete (Style Bible), so it must read as scaffolding at 1× and stay transparent.
export function paintScaffolding(): RawImage {
  const img: RawImage = {
    width: SCAFFOLD_W,
    height: SCAFFOLD_H,
    data: new Uint8ClampedArray(SCAFFOLD_W * SCAFFOLD_H * 4),
  }
  const put = (x: number, y: number, hex: number): void => {
    if (x < 0 || y < 0 || x >= SCAFFOLD_W || y >= SCAFFOLD_H) return
    const i = (y * SCAFFOLD_W + x) * 4
    img.data[i] = (hex >> 16) & 0xff
    img.data[i + 1] = (hex >> 8) & 0xff
    img.data[i + 2] = hex & 0xff
    img.data[i + 3] = 255
  }
  for (let y = 2; y < SCAFFOLD_H - 2; y++) for (const x of [6, 7, 24, 25]) put(x, y, SCAFFOLD_POST)
  for (const y of [8, 9, 20, 21]) for (let x = 6; x <= 25; x++) put(x, y, SCAFFOLD_BRACE)
  for (let k = 0; k <= 11; k++) put(7 + k + k, 9 + k, SCAFFOLD_BRACE) // one diagonal, post to rail
  return img
}

export type TilesetSheets = { seasons: Record<Season, RawImage>; scaffolding: RawImage }

export function paintTilesetSheets(): TilesetSheets {
  return {
    seasons: Object.fromEntries(SEASONS.map((s) => [s, paintSeasonSheet(s)])) as Record<
      Season,
      RawImage
    >,
    scaffolding: paintScaffolding(),
  }
}
