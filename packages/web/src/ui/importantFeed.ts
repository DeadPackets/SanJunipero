import {
  CHRONICLE_FALLBACK_ICON,
  type ChronicleLookup,
  type SimEvent,
  agentName,
  chronicleLine,
  kindWords,
} from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { EMBER, HONEY, INK, ROSE, SAGE, SAND, STONE, WATER, art } from './pixelArt.js'

// Shares `chronicleLine` with the gateway, so a live event and a chronicle entry read as the same
// sentence. Authored mystery prose is engine data the browser bundle does not carry, so it stays quiet.
export function chronicleLabel(ev: SimEvent, state: WorldState | null): string | null {
  const look: ChronicleLookup = {
    agentName: (id) => agentName(state?.agents, id),
    // R4: prose to a viewer, never the engine's slug
    structureKind: (id) => kindWords(state?.structures[id]?.kind ?? 'building'),
    mysteryProse: () => null,
    partnerOf: (id) => state?.agents[id]?.partnerId ?? null,
  }
  return chronicleLine(ev, look)
}

// ------------------------------------------------------------------ chronicle glyphs

// The same law the weather strip follows: palette hexes on an 8×8 grid, never an emoji, whose
// shape and colour would belong to the reader's font rather than to the town.
export type ChronicleGlyph = {
  label: string
  pixels: readonly (readonly [number, number, string])[]
}

// Every fill a glyph may use — all MASTER_PALETTE members, asserted as a set by the tests.
export const GLYPH_PALETTE: readonly string[] = [INK, EMBER, HONEY, SAGE, ROSE, WATER, STONE, SAND]

export const CHRONICLE_GLYPH: Record<string, ChronicleGlyph> = {
  cross: {
    label: 'a death',
    pixels: art('........', '...ii...', '...ii...', '.iiiiii.', '...ii...', '...ii...', '...ii...'),
  },
  spark: {
    label: 'a first',
    pixels: art('...hh...', '...hh...', '..a..a..', 'hh.hh.hh', 'hh.hh.hh', '..ahha..', '...hh...'),
  },
  heart: {
    label: 'a night kept together',
    pixels: art('........', '..r..r..', '.r.rr.r.', '.rrrrrr.', '..rrrr..', '...rr...'),
  },
  house: {
    label: 'a building finished',
    pixels: art('........', '...gg...', '..g..g..', '.g....g.', '.gaaaag.', '.gaiiag.', '.gaiiag.'),
  },
  flame: {
    label: 'a fire',
    // the honey core is painted over the ember body, so it comes second
    pixels: [
      ...art('...e....', '...ee...', '..eeee..', '..eeee..', '..eeee..', '...ee...'),
      ...art('........', '........', '........', '...h....', '....h...'),
    ],
  },
  quill: {
    label: 'words carved',
    pixels: art('......w.', '.....ww.', '....ww..', '...ww...', '..ww....', '.ww.....', '.iiiii..'),
  },
  leaf: {
    label: 'a sickness, and the turn of it',
    // the ink vein runs over the leaf, so it comes second
    pixels: [
      ...art('........', '.....gg.', '....ggg.', '...gggg.', '...ggg..', '..ggg...', '.i......'),
      ...art('........', '......i.', '.....i..', '....i...', '...i....', '..i.....'),
    ],
  },
  road: {
    label: 'the ground worked',
    // the ink ruts run over the sand, so they come second
    pixels: [
      ...art('........', '........', 'ssssssss', 'aaaaaaaa', 'aaaaaaaa', 'ssssssss'),
      ...art('........', '........', '........', '.ii..ii.'),
    ],
  },
  key: {
    label: 'a discovery',
    // the ward is honey; INK carries the whole silhouette, so the shape survives it being removed
    pixels: art(
      '........',
      '..iii...',
      '.i.h.i..',
      '.i.h.i..',
      '..iii...',
      '...i....',
      '...ii...',
      '...i....',
    ),
  },
  star: {
    label: 'something the town cannot explain',
    pixels: art(
      '...ss...',
      '...ss...',
      '........',
      'sssaasss',
      'sssaasss',
      '........',
      '...ss...',
      '...ss...',
    ),
  },
}

export function chronicleGlyph(icon: string): ChronicleGlyph {
  return CHRONICLE_GLYPH[icon] ?? CHRONICLE_GLYPH[CHRONICLE_FALLBACK_ICON]!
}
