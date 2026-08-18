import type { CodexEntry } from './codex.js'

// The ladder is a ladder of REACH, not a tech tree. A town with a generator and a shed does
// not discover pottery; the rung it climbs is what a thing costs to get hold of, and the top
// two rungs are the ones the canon puts out of reach for good.
export const ERAS = ['handwork', 'arrangement', 'works', 'machinery', 'industry'] as const
export type Era = (typeof ERAS)[number]
export const ERA_ORDER: Record<Era, number> = {
  handwork: 1,
  arrangement: 2,
  works: 3,
  machinery: 4,
  industry: 5,
}

// The world canon block (Task 4's system-message prefix). Fully diegetic: it
// speaks as the town's own people, never as a game designer. Byte-stable.
// Every noun here is checked twice before it lands: FORBIDDEN_FRAMING bans the word
// "tool", and the one-way glass bans "custom", "market", "council" and "festival" — which
// is why a shared arrangement is described here and never named.
export const CANON = `The town of San Junipero sits where two branches of a river meet, in a wide valley of field and forest. Its people farm the ground, fish the water, and keep their own machinery in repair. A generator gives them light and current for as long as somebody feeds it. What breaks here is mended here, by hand, out of what the sheds already hold.

There is no factory within reach of this valley, no yard that pours metal, no counter that will sell them a finished part. Nothing arrives from outside; what cannot be made or mended between these two rivers cannot be had at all. So the new thing this town finds is far more often an arrangement between its people — a turn agreed at the well, a store held in common, a name that sticks to a place — than a machine nobody here could build.

What the town can make is only what its own hands already know how to begin; each new craft must be reached from one the town already practices, one careful step at a time.`

// WHAT THE TOWN WAKES UP KNOWING, and the rungs one careful step past it. Two gate scripts
// each carried their own copy of this list and the two had already drifted apart, so it lives
// here now — beside the canon that has to agree with it — and both import it.
//
// Every practised craft is a thing hands do in this valley and answers to a skill track the
// recipes already name. Nothing the canon denies has an id: no id can be copied into a
// recipe's canon that is not on one of these two lines, and that is the whole of the
// boundary the arbiter rules against.
//
// The unearned rungs are where the setting earns its keep. A town with a generator does not
// discover pottery; what it finds one step out is as often an arrangement between its people
// — a turn agreed for the fields, a store held in common, a stone raised for the dead — as it
// is a craft. Each still hangs off a craft the town practises, because adjacency is the
// engine here and it is not being softened.
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
