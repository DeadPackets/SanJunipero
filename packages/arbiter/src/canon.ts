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
