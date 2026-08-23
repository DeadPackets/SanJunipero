// ★ THE REFERENCE SHEET IS A COLOUR CHART. IT WAS NEVER SUPPOSED TO BE THREE PICTURES.
//
// This module used to demand four files — `style-anchor.png` plus `ref-1.png`, `ref-2.png`,
// `ref-3.png` — and hand all four to `createForge`, which passes them as `input_references` on
// EVERY generation. `gen-reference-sheet.ts` says what the three were meant to be: a cottage,
// a bucket and a villager, one per subject class, curated by hand.
//
// ref-1..3 were never curated, so this function threw on every call, so `gen-rigs.ts` and
// `gen-terrain.ts` could not start and the discovery lane's `discoveryArt` had to ship as a
// tested no-op. The obvious repair is to generate the three missing pictures. THE OBVIOUS
// REPAIR IS WRONG, and it is wrong for a reason this project has now measured twice:
//
//   Round 3 lost the farmhouse three times to the reference image overriding the prompt, and
//   lost farmland_0 to the anchor cottage self-tiling into rows of isometric cottages. Round 4
//   ran the A/B for $0.2053 — same cabin prompt, once with the style anchor attached and once
//   with a code-painted MASTER_PALETTE swatch. With the anchor it came back as THE ANCHOR
//   RECOLOURED, arched door and gable and all, against a prompt that banned the arch by name.
//   With the swatch it came back as the cabin that was asked for.
//   `gen-cast-v4.ts` found the same thing independently and grew a WALK_NO_STYLE_ANCHOR
//   escape hatch because the anchor cottage kept bleeding into walk frames as scenery.
//
// ONE reference object of a DIFFERENT subject costs a generation its architecture. The old
// contract attached FOUR. Curating ref-1..3 would have been paying real money to make every
// future generation worse, permanently, and the loader would have been green while it did it.
//
// So the reference sheet is now what a reference is actually for: the palette, and nothing
// else. A swatch has no architecture in it to copy. It is code-painted, so it is free, it is
// deterministic, and it can never go missing from a scratchpad — which is the third defect
// this lane exists to close.
//
// `style-anchor.png` stays committed. It is the craft record and the human-designated look,
// and `styleBible.md` still points at it. It is simply not attached to generations any more.
import { encodePng } from './post/raw.js'
import { MASTER_PALETTE, paletteRgb } from './palette.js'

/** Edge of one swatch square, in pixels. Big enough that the provider cannot read the chart
 *  as texture and small enough that the whole palette fits one modest image. */
export const REF_SWATCH_PX = 64
export const REF_SWATCH_COLS = 8

/** The one reference this project attaches to a generation: every MASTER_PALETTE member as a
 *  flat square, no subject, no architecture, no projection. */
export async function paletteSwatchPng(): Promise<Buffer> {
  const rgb = paletteRgb(MASTER_PALETTE)
  const rows = Math.ceil(rgb.length / REF_SWATCH_COLS)
  const width = REF_SWATCH_COLS * REF_SWATCH_PX, height = rows * REF_SWATCH_PX
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgb.length; i++) {
    const [r, g, b] = rgb[i]!
    const cx = (i % REF_SWATCH_COLS) * REF_SWATCH_PX, cy = Math.floor(i / REF_SWATCH_COLS) * REF_SWATCH_PX
    for (let y = cy; y < cy + REF_SWATCH_PX; y++) for (let x = cx; x < cx + REF_SWATCH_PX; x++) {
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  return encodePng({ width, height, data })
}

/** Every reference a generation may carry. Exactly one entry, and it is not a picture of
 *  anything. Kept as an array because `createForge` and the judges take a list. */
export async function loadReferenceSheet(): Promise<Buffer[]> {
  return [await paletteSwatchPng()]
}
