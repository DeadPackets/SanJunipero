// The authored table of things the world does and never explains. Nothing here resolves: the
// prose is the whole of the event — fold changes no state at all.
export type MysteryScope = 'global' | 'located'

export type MysteryDef = {
  kind: string
  scope: MysteryScope
  prose: string
}

export const MYSTERIES: readonly MysteryDef[] = [
  {
    kind: 'flames_gutter_blue',
    scope: 'global',
    prose: 'Every flame gutters blue for a single breath, then burns yellow again.',
  },
  {
    kind: 'far_bell',
    scope: 'global',
    prose: 'A bell rings once, very far off. Nobody here owns a bell.',
  },
  {
    kind: 'birds_fall_silent',
    scope: 'global',
    prose: 'Every bird stops singing at the same moment, and stays quiet for a slow count of ten.',
  },
  {
    kind: 'wind_from_nowhere',
    scope: 'global',
    prose: 'A warm wind comes in from the wrong quarter and dies as suddenly as it came.',
  },
  {
    kind: 'shadows_lag',
    scope: 'global',
    prose: "For one breath every shadow lies a hand's width from where it should be.",
  },
  {
    kind: 'sweet_air',
    scope: 'global',
    prose: 'The air turns sweet for a while, like fruit that is not in season.',
  },
  {
    kind: 'stone_hums',
    scope: 'located',
    prose: 'The stone here hums, low, and the sound leaves it very slowly.',
  },
  {
    kind: 'pressed_grass_ring',
    scope: 'located',
    prose: 'A ring of grass lies pressed flat here, unbroken, with no path in or out of it.',
  },
  {
    kind: 'light_beneath_water',
    scope: 'located',
    prose: 'A pale light moves under the surface here and never comes up.',
  },
  {
    kind: 'frost_in_the_sun',
    scope: 'located',
    prose: 'A patch of frost lies here in open sunlight and does not melt.',
  },
]

export const MYSTERY_BY_KIND: Readonly<Record<string, MysteryDef>> = Object.fromEntries(
  MYSTERIES.map((m) => [m.kind, m]),
)
