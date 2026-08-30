import { Container, type RenderTexture, type Sprite } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { bigTownTerrain } from './bigTown.js'
import {
  BAKES_PER_FRAME,
  createGroundBaker,
  TILE_EDGE_OUTSET_PX,
  tileDiamond,
} from './groundBake.js'
import { groundField, SKIRT_KIND } from './groundField.js'
import { TILE_H, TILE_W } from './iso.js'
import { TextureBook } from './textures.js'

const SS = 8 // sub-samples per axis
const FIELD_LUMA = 148.6 // the grass field the critique measured
const STAGE_LUMA = 46 // BACKGROUND 0x322b38

function insideDiamond(pts: number[], x: number, y: number): boolean {
  const cx = pts[0]!,
    top = pts[1]!,
    right = pts[2]!,
    bottom = pts[5]!,
    left = pts[6]!
  const cy = (top + bottom) / 2
  const hw = (right - left) / 2,
    hh = (bottom - top) / 2
  return Math.abs(x - cx) / hw + Math.abs(y - cy) / hh <= 1
}

/** Alpha per pixel after every tile of an `n × n` patch is drawn on its own over transparent. */
function bakeAlpha(n: number, outset: number): { alpha: Float32Array; w: number; h: number } {
  const w = (n + n) * (TILE_W / 2) + 2,
    h = (n + n) * (TILE_H / 2) + 2
  const offX = n * (TILE_W / 2) + 1,
    offY = 1
  const alpha = new Float32Array(w * h)
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const pts = tileDiamond(
        (tx - ty) * (TILE_W / 2) + offX,
        (tx + ty) * (TILE_H / 2) + offY,
        outset,
      )
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          let hit = 0
          for (let sy = 0; sy < SS; sy++)
            for (let sx = 0; sx < SS; sx++)
              if (insideDiamond(pts, px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)) hit++
          const c = hit / (SS * SS)
          if (c === 0) continue
          const i = py * w + px
          alpha[i] = alpha[i]! + c * (1 - alpha[i]!) // `over`, same colour on both sides
        }
      }
    }
  }
  return { alpha, w, h }
}

/** The darkest pixel strictly inside the patch — the seam, if there is one — as a luma ratio. */
function edgeLumaRatio(outset: number): number {
  const n = 4
  const { alpha, w, h } = bakeAlpha(n, outset)
  // the patch's own outline is a real edge; stay two pixels inside it
  const cx = n * (TILE_W / 2) + 1
  let worst = 1
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = Math.abs(px + 0.5 - cx) / (n * (TILE_W / 2) - 2)
      const dy = Math.abs(py + 0.5 - (1 + n * (TILE_H / 2))) / (n * (TILE_H / 2) - 2)
      if (dx + dy > 1) continue
      const a = alpha[py * w + px]!
      const luma = a * FIELD_LUMA + (1 - a) * STAGE_LUMA
      worst = Math.min(worst, luma / FIELD_LUMA)
    }
  }
  return worst
}

describe('★ D3 — the tile-edge dark line', () => {
  it('THE DEFECT: with no outset, a shared edge reads about ×0.85 of the field', () => {
    const r = edgeLumaRatio(0)
    expect(r).toBeLessThan(0.9)
    expect(r).toBeGreaterThan(0.75)
  })

  it('★ THE FIX: with the half-pixel outset every interior pixel reads ×1.00', () => {
    // 0.989 at the four-way vertex: 1.6 luma, under the grass material's own σ of 4.27
    expect(edgeLumaRatio(TILE_EDGE_OUTSET_PX)).toBeGreaterThan(0.98)
  })

  it('the outset is half a pixel on every side, and the baker draws with it by default', () => {
    expect(TILE_EDGE_OUTSET_PX).toBe(0.5)
    const [x0, y0, x1, y1, x2, y2, x3, y3] = tileDiamond(100, 50)
    expect([x0, y0]).toEqual([100, 49.5])
    expect([x1, y1]).toEqual([116.5, 58])
    expect([x2, y2]).toEqual([100, 66.5])
    expect([x3, y3]).toEqual([83.5, 58])
  })
})

type Bake = { at: { x: number; y: number }; kids: Container[] }

function drive(rings: number) {
  const renders: Bake[] = []
  const renderer = {
    render: (o: { container: Container; target: RenderTexture; clear: boolean }) => {
      renders.push({
        at: { x: o.container.position.x, y: o.container.position.y },
        kids: [...o.container.children],
      })
    },
  }
  const root = new Container()
  const baker = createGroundBaker(renderer, root, new TextureBook())
  const terrain = bigTownTerrain(rings) as never
  const field = groundField(terrain, [])
  return { baker, root, renders, terrain, field }
}

const viewAt = (
  z: number,
  f: { widthPx: number; heightPx: number; offsetX: number; offsetY: number },
) => ({
  x: f.widthPx / 2 - f.offsetX - 1728 / z / 2,
  y: f.heightPx / 2 - f.offsetY - 880 / z / 2,
  w: 1728 / z,
  h: 880 / z,
})

describe('★ U7 — the skirt', () => {
  it('is baked under the field in every chunk that reaches the map edge', () => {
    const d = drive(1)
    d.baker.setView(viewAt(0.25, d.field))
    d.baker.rebake(d.terrain, [])
    expect(d.field.skirt.kind).toBe(SKIRT_KIND)
    // the first fill of every chunk is the skirt's — the field's own layers come after it
    expect(d.renders.length).toBeGreaterThan(0)
    for (const r of d.renders) expect(r.kids.length).toBeGreaterThan(1)
    // the chunk sprites are placed with BOTH offsets, so the skirt's negative rows land north of the map
    const ys = (d.root.children as Sprite[]).map((s) => s.position.y)
    expect(Math.min(...ys)).toBe(-d.field.offsetY)
  })
})

describe('★ D17 — the bake is metered', () => {
  it('a view that reveals a whole grid bakes BAKES_PER_FRAME chunks a frame, and gets there', () => {
    const d = drive(10)
    d.baker.setView(viewAt(4, d.field))
    d.baker.rebake(d.terrain, [])
    const tight = d.baker.vram().chunks
    const wide = viewAt(0.25, d.field)
    let last = tight
    const steps: number[] = []
    for (let i = 0; i < 64; i++) {
      d.baker.setView(wide)
      const now = d.baker.vram().chunks
      steps.push(now - last)
      last = now
    }
    expect(Math.max(...steps)).toBeLessThanOrEqual(BAKES_PER_FRAME)
    expect(last).toBeGreaterThan(tight)
    expect(steps.at(-1)).toBe(0) // it drained
  })

  it('a new map still appears whole on its first frame', () => {
    const d = drive(3)
    d.baker.setView(viewAt(0.25, d.field))
    d.baker.rebake(d.terrain, [])
    const first = d.baker.vram().chunks
    for (let i = 0; i < 16; i++) d.baker.setView(viewAt(0.25, d.field))
    expect(d.baker.vram().chunks).toBe(first)
    expect(first).toBeGreaterThan(1)
  })
})
