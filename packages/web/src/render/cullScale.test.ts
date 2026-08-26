import { describe, expect, it } from 'vitest'
import { ZOOM_STOPS, drawnBoundsOf } from './camera.js'
import { CULL_MARGIN_PX, boxInView, type ViewRect } from './cull.js'
import {
  DEPTH_BUDGET, bodyDepthBox, depthOrder, structureDepthBox, type DepthBox,
} from './depth.js'
import { bigTown, bigTownScreenSize, type FixtureStructure } from './bigTown.js'

// ── WHAT THE CULL IS WORTH, IN NUMBERS ────────────────────────────────────────────────────
// Every number here comes from pure functions over a synthetic world, never from a browser's
// own report.

/** The audit's stage, less the 56 px the control bar takes off the bottom. */
const STAGE = { w: 1728, h: 880 - 56 }

/** A viewport centred on the middle of the town, in the world space `tileToScreen` produces. */
function viewAt(scale: number, centre: { sx: number; sy: number }): ViewRect {
  return {
    x: centre.sx - STAGE.w / (2 * scale), y: centre.sy - STAGE.h / (2 * scale),
    w: STAGE.w / scale, h: STAGE.h / scale,
  }
}

/** Pixi batches consecutive sprites sharing a texture, so a DRAW CALL is a run of one kind in painter's order. Kind stands in for texture: the codex resolves one art url per kind. */
function drawCalls(order: readonly string[], kindOf: ReadonlyMap<string, string>): number {
  let calls = 0, last: string | null = null
  for (const id of order) {
    const k = kindOf.get(id) ?? ''
    if (k !== last) calls++
    last = k
  }
  return calls
}

type Row = {
  zoom: number
  objects: number
  drawn: number
  culled: number
  callsCulled: number
  callsUncalled: number
  pairsCulled: number
  pairsUncalled: number
  budgetBlown: boolean
}

/** Bodies walking the streets, one per two blocks — the other half of what `entities` holds. */
function townBodies(town: readonly FixtureStructure[]): DepthBox[] {
  return town
    .filter((_, i) => i % 2 === 0)
    .map((s, i) => bodyDepthBox(`body_${i}`, s.x + 1.5, s.y + 2.5))
}

function measure(town: readonly FixtureStructure[]): Row[] {
  const boxes: DepthBox[] = [
    ...town.map((s) => structureDepthBox(s.id, s)),
    ...townBodies(town),
  ]
  const kindOf = new Map<string, string>([
    ...town.map((s) => [s.id, s.kind] as const),
    ...townBodies(town).map((b) => [b.id, 'body'] as const),
  ])
  const b = drawnBoundsOf(town)
  const centre = { sx: (b.minX + b.maxX) / 2, sy: (b.minY + b.maxY) / 2 }
  const allOrder = depthOrder(boxes)
  const pairs = (n: number): number => (n * (n - 1)) / 2
  return ZOOM_STOPS.map((z) => {
    const view = viewAt(z, centre)
    const kept = boxes.filter((x) => boxInView(x, view))
    return {
      zoom: z,
      objects: boxes.length,
      drawn: kept.length,
      culled: boxes.length - kept.length,
      callsCulled: drawCalls(depthOrder(kept), kindOf),
      callsUncalled: drawCalls(allOrder, kindOf),
      pairsCulled: kept.length > DEPTH_BUDGET ? 0 : pairs(kept.length),
      pairsUncalled: boxes.length > DEPTH_BUDGET ? 0 : pairs(boxes.length),
      budgetBlown: boxes.length > DEPTH_BUDGET,
    }
  })
}

function table(name: string, rows: readonly Row[]): string {
  const head = `\n${name}\n  zoom | objects | drawn | culled |  % | calls culled | calls uncalled | budget`
  const body = rows.map((r) =>
    `  ${String(r.zoom).padStart(4)} | ${String(r.objects).padStart(7)} | ${String(r.drawn).padStart(5)}`
    + ` | ${String(r.culled).padStart(6)} | ${String(Math.round((r.culled / r.objects) * 100)).padStart(2)}`
    + ` | ${String(r.callsCulled).padStart(12)} | ${String(r.callsUncalled).padStart(14)}`
    + ` | ${r.drawn > DEPTH_BUDGET ? 'BLOWN' : 'ok'} vs ${r.budgetBlown ? 'BLOWN' : 'ok'}`).join('\n')
  return `${head}\n${body}`
}

describe('the cull, measured on a town the viewport cannot hold', () => {
  for (const rings of [1, 2, 3] as const) {
    const town = bigTown(rings)
    const rows = measure(town)
    const size = bigTownScreenSize(rings)

    it(`${rings} ring(s): ${town.length} structures over ${size.w} × ${size.h} px — the table`, () => {
      console.log(table(`${rings} ring(s) — ${town.length} structures, ${size.w} × ${size.h} px at scale 1`, rows))
      expect(rows).toHaveLength(ZOOM_STOPS.length)
    })

    it(`${rings} ring(s): the tighter the view, the less it draws — monotonically`, () => {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.drawn, `zoom ${rows[i]!.zoom} vs ${rows[i - 1]!.zoom}`)
          .toBeLessThanOrEqual(rows[i - 1]!.drawn)
      }
      expect(rows[rows.length - 1]!.drawn).toBeLessThan(rows[0]!.drawn)
      // A one-ring town is 1792 × 896 px and the stage holds 1728 × 824 plus two margins, so
      // it fits at 1× and nothing is culled — correct, and the reason this starts at two.
      if (rings >= 2) {
        for (const r of rows.filter((x) => x.zoom >= 1)) {
          expect(r.culled, `zoom ${r.zoom}`).toBeGreaterThan(0)
        }
      }
    })
  }

  // At the overview stop the whole town is on screen by definition, so `depthOrder` is handed the
  // settlement and passes `DEPTH_BUDGET`. A house is eight pixels tall there and an occlusion
  // error is not visible, which is the case the counted fallback was built for.
  it('★ the budget holds from 1× in, and gives way only at the overview', () => {
    const rows = measure(bigTown(3))
    const overview = rows.find((r) => r.zoom === 0.5)!
    expect(overview.drawn).toBeGreaterThan(DEPTH_BUDGET)
    for (const r of rows.filter((x) => x.zoom >= 1)) {
      expect(r.drawn, `zoom ${r.zoom} must stay inside the budget`).toBeLessThanOrEqual(DEPTH_BUDGET)
    }
  })

  it('never draws more than it did before the cull existed', () => {
    for (const rings of [1, 2, 3] as const) {
      for (const r of measure(bigTown(rings))) expect(r.drawn).toBeLessThanOrEqual(r.objects)
    }
  })

  it('the margin is the only slack: it keeps a bounded ring of extra work, not a fraction of the town', () => {
    const town = bigTown(3)
    const boxes = town.map((s) => structureDepthBox(s.id, s))
    const b = drawnBoundsOf(town)
    const centre = { sx: (b.minX + b.maxX) / 2, sy: (b.minY + b.maxY) / 2 }
    for (const z of ZOOM_STOPS) {
      const view = viewAt(z, centre)
      const tight = boxes.filter((x) => boxInView(x, view, 0)).length
      const slack = boxes.filter((x) => boxInView(x, view)).length
      expect(slack - tight, `zoom ${z} pays ${slack - tight} extra for ${CULL_MARGIN_PX}px of margin`)
        .toBeLessThan(Math.max(8, tight))
    }
  })
})
