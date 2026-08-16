export const ERAS = ['agriculture', 'crafts', 'metallurgy', 'chemistry', 'engineering'] as const
export type Era = (typeof ERAS)[number]
export const ERA_ORDER: Record<Era, number> = {
  agriculture: 1,
  crafts: 2,
  metallurgy: 3,
  chemistry: 4,
  engineering: 5,
}

// The world canon block (Task 4's system-message prefix). Fully diegetic: it
// speaks as the town's own people, never as a game designer. Byte-stable.
export const CANON = `The town of San Junipero sits where two branches of a river meet, in a wide meadow of tall grass. Its people till the soil and shape river clay into pots, work wood and fiber with their hands, and strike sparks from flint for their fires. Stone is their hardest implement and fire their warmest craft.

No one here has ever drawn metal from stone, mixed the black powder, or caught the sky's lightning in a jar. What the town can make is only what its own hands already know how to begin; each new craft must be reached from one the town already practices, one careful step at a time.`
