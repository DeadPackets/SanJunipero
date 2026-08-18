import { kindWords } from './broadcastReady.js'
import { CHRONICLE_FALLBACK_ICON, chronicleLine, type ChronicleLookup, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

// The viewer's half of the chronicle formatter. It shares chronicleLine with the gateway, so
// a live event and a chronicle entry read as the same sentence rather than two near-misses.
// The authored mystery prose lives in the engine's data tables, which the browser bundle does
// not carry — a mystery therefore arrives labelled through /api/chronicle, and this formatter
// stays quiet rather than inventing a second version of the town's own words.
export function chronicleLabel(ev: SimEvent, state: WorldState | null): string | null {
  const look: ChronicleLookup = {
    agentName: (id) => state?.agents[id]?.name ?? id,
    // R4: prose to a viewer, never the engine's slug
    structureKind: (id) => kindWords(state?.structures[id]?.kind ?? 'building'),
    mysteryProse: () => null,
  }
  return chronicleLine(ev, look)
}

// ------------------------------------------------------------------ chronicle glyphs

// The same law the weather strip follows: palette hexes on an 8×8 grid, never an emoji, whose
// shape and colour would belong to the reader's font rather than to the town.
export type ChronicleGlyph = { label: string; pixels: ReadonlyArray<readonly [number, number, string]> }

const INK = '#43394A', EMBER = '#E8785A', HONEY = '#F2C879', SAGE = '#93B573'
const ROSE = '#C47876', WATER = '#7FB0C9', STONE = '#ABA198', SAND = '#E8D5BC'

// Every fill a glyph may use — all MASTER_PALETTE members, asserted as a set by the tests.
export const GLYPH_PALETTE: readonly string[] = [INK, EMBER, HONEY, SAGE, ROSE, WATER, STONE, SAND]

const px = (
  fill: string, ...cells: ReadonlyArray<readonly [number, number]>
): Array<readonly [number, number, string]> => cells.map(([x, y]) => [x, y, fill] as const)

export const CHRONICLE_GLYPH: Record<string, ChronicleGlyph> = {
  cross: {
    label: 'a death',
    pixels: [
      ...px(INK, [3, 1], [4, 1], [3, 2], [4, 2], [3, 3], [4, 3], [3, 4], [4, 4], [3, 5], [4, 5], [3, 6], [4, 6]),
      ...px(INK, [1, 3], [2, 3], [5, 3], [6, 3]),
    ],
  },
  spark: {
    label: 'a first',
    pixels: [
      ...px(HONEY, [3, 0], [4, 0], [3, 1], [4, 1], [3, 5], [4, 5], [3, 6], [4, 6]),
      ...px(HONEY, [0, 3], [1, 3], [6, 3], [7, 3], [0, 4], [1, 4], [6, 4], [7, 4]),
      ...px(HONEY, [3, 3], [4, 3], [3, 4], [4, 4]),
      ...px(SAND, [2, 2], [5, 2], [2, 5], [5, 5]),
    ],
  },
  heart: {
    label: 'a night kept together',
    pixels: [
      ...px(ROSE, [1, 2], [2, 1], [3, 2], [4, 2], [5, 1], [6, 2]),
      ...px(ROSE, [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3]),
      ...px(ROSE, [2, 4], [3, 4], [4, 4], [5, 4]),
      ...px(ROSE, [3, 5], [4, 5]),
    ],
  },
  house: {
    label: 'a building finished',
    pixels: [
      ...px(SAGE, [3, 1], [4, 1], [2, 2], [5, 2], [1, 3], [6, 3]),
      ...px(SAGE, [1, 4], [6, 4], [1, 5], [6, 5], [1, 6], [6, 6]),
      ...px(SAND, [2, 4], [3, 4], [4, 4], [5, 4], [2, 5], [5, 5], [2, 6], [5, 6]),
      ...px(INK, [3, 5], [4, 5], [3, 6], [4, 6]),
    ],
  },
  flame: {
    label: 'a fire',
    pixels: [
      ...px(EMBER, [3, 0], [4, 1], [3, 1], [2, 2], [3, 2], [4, 2], [5, 2]),
      ...px(EMBER, [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [3, 4], [4, 4], [5, 4]),
      ...px(EMBER, [3, 5], [4, 5]),
      ...px(HONEY, [3, 3], [4, 4]),
    ],
  },
  quill: {
    label: 'words carved',
    pixels: [
      ...px(WATER, [6, 0], [5, 1], [6, 1], [4, 2], [5, 2], [3, 3], [4, 3]),
      ...px(WATER, [2, 4], [3, 4], [1, 5], [2, 5]),
      ...px(INK, [1, 6], [2, 6], [3, 6], [4, 6], [5, 6]),
    ],
  },
  star: {
    label: 'something the town cannot explain',
    pixels: [
      ...px(STONE, [3, 0], [4, 0], [3, 1], [4, 1]),
      ...px(STONE, [0, 3], [1, 3], [2, 3], [5, 3], [6, 3], [7, 3]),
      ...px(STONE, [0, 4], [1, 4], [2, 4], [5, 4], [6, 4], [7, 4]),
      ...px(STONE, [3, 6], [4, 6], [3, 7], [4, 7]),
      ...px(SAND, [3, 3], [4, 3], [3, 4], [4, 4]),
    ],
  },
}

export function chronicleGlyph(icon: string): ChronicleGlyph {
  return CHRONICLE_GLYPH[icon] ?? CHRONICLE_GLYPH[CHRONICLE_FALLBACK_ICON]!
}
