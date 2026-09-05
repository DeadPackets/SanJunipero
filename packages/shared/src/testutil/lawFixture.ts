// The three rules the scene prototype's councils actually reached (`docs/superpowers/specs/v2/
// scene-proto/transcripts.md`), each with the shape the court compiled it to. One truth for the
// engine's judge, the council's compile test and the viewer's page.

/** A predicate is the engine's to define; a fixture only has to be a valid one, which whoever
 *  reads it proves by parsing it with `LawPredicateSchema`. */
export type LawFixturePredicate = { kind: string } & Record<string, unknown>

export type LawFixture = {
  id: string
  /** What the town calls it, in the mouths that made it. Not part of any payload. */
  name: string
  text: string
  proposedBy: string
  votes: { for: string[]; against: string[] }
  predicate: LawFixturePredicate
  why: string
}

// The two public roofs the predicates point at, in the shape genesis mints: the storehouse is
// the first building the town raises, the fire pit the monument beside the well.
export const LAW_FIXTURE_STOREHOUSE = 'structure_1'
export const LAW_FIXTURE_FIRE_PIT = 'structure_2'

export const LAW_FIXTURE: readonly LawFixture[] = [
  {
    id: 'law_slate',
    name: 'the slate rule',
    text: "Nobody takes another's planks. Say the day you will bring them, and bring them.",
    proposedBy: 'nadia',
    votes: { for: ['nadia', 'omar'], against: [] },
    predicate: { kind: 'forbid', verb: 'take', whose: 'other' },
    why: 'The promise is theirs to keep. What the town can hold is that nobody lifts what is not theirs.',
  },
  {
    id: 'law_fire_tax',
    name: 'the fire tax',
    text: 'Bring a log to the fire before you take one from it, every day.',
    proposedBy: 'salma',
    votes: { for: ['salma'], against: ['yusuf'] },
    predicate: {
      kind: 'tithe',
      itemKind: 'wood',
      qty: 1,
      to: LAW_FIXTURE_FIRE_PIT,
      every: 'day',
    },
    why: 'A tax is a thing given at a place on a clock, and the fire is the place they sat at.',
  },
  {
    id: 'law_well_order',
    name: 'well-order',
    text: 'Whoever slept the night draws first: nobody fills a vessel before they have slept.',
    proposedBy: 'amara',
    votes: { for: ['amara', 'salma'], against: [] },
    predicate: { kind: 'require_before', verb: 'fill', before: 'sleep' },
    why: 'The row holds by sleeping, so the well asks for a night before it asks for a bucket.',
  },
]
