import type { CodexEntry } from './codex.js'

// A ladder of reach, not a tech tree: the rung is what a thing costs to get hold of, and the
// top two are the ones the canon puts out of reach for good.
export const ERAS = ['handwork', 'arrangement', 'works', 'machinery', 'industry'] as const
export type Era = (typeof ERAS)[number]
export const ERA_ORDER: Record<Era, number> = {
  handwork: 1,
  arrangement: 2,
  works: 3,
  machinery: 4,
  industry: 5,
}

// Mind-facing and byte-stable, written as the town's own people and never as a game designer;
// every noun clears FORBIDDEN_FRAMING and the one-way-glass roster, which is why a shared
// arrangement is described and never named.
export const CANON = `The town of San Junipero sits where two branches of a river meet, in a wide valley of field and forest. Its people farm the ground, fish the water, and keep their own machinery in repair. A generator gives them light and current for as long as somebody feeds it. What breaks here is mended here, by hand, out of what the sheds already hold.

There is no factory within reach of this valley, no yard that pours metal, no counter that will sell them a finished part. Nothing arrives from outside; what cannot be made or mended between these two rivers cannot be had at all. So the new thing this town finds is far more often an arrangement between its people — a turn agreed at the well, a store held in common, a name that sticks to a place — than a machine nobody here could build.

What the town can make is only what its own hands already know how to begin; each new craft must be reached from one the town already practices, one careful step at a time.`

// No id may be copied into a recipe's canon that is not on one of these two lines — that is the
// whole of the boundary the arbiter rules against.
// An unearned rung is as often an arrangement between people as a craft, but it always hangs
// off a craft the town practises.
export const GENESIS_CODEX: readonly CodexEntry[] = [
  { id: 'farming', era: 'handwork', name: 'Farming', prerequisiteId: null },
  { id: 'fishing', era: 'handwork', name: 'Fishing', prerequisiteId: null },
  { id: 'foraging', era: 'handwork', name: 'Foraging', prerequisiteId: null },
  { id: 'carpentry', era: 'handwork', name: 'Carpentry', prerequisiteId: null },
  { id: 'masonry', era: 'handwork', name: 'Masonry', prerequisiteId: null },
  { id: 'tailoring', era: 'handwork', name: 'Tailoring', prerequisiteId: null },
  { id: 'cooking', era: 'handwork', name: 'Cooking', prerequisiteId: null },
  { id: 'machine_repair', era: 'handwork', name: 'Machine repair', prerequisiteId: null },

  { id: 'work_rota', era: 'arrangement', name: 'A turn agreed for the fields', prerequisiteId: 'farming', known: false },
  { id: 'common_store', era: 'arrangement', name: 'A store held in common', prerequisiteId: 'farming', known: false },
  { id: 'food_preserving', era: 'arrangement', name: 'Keeping food past its week', prerequisiteId: 'cooking', known: false },
  { id: 'memorial', era: 'arrangement', name: 'A stone raised for the dead', prerequisiteId: 'masonry', known: false },
  { id: 'bridging', era: 'arrangement', name: 'Bridging', prerequisiteId: 'carpentry', known: false },
]
