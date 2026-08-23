import { tickToMoment, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { LENSES, type Lens } from './route.js'

export type TownStats = { day: number; time: string; weather: string; alive: number; total: number }

export const WEATHER_UNKNOWN = '—'

export function townStats(state: WorldState | null, tick: number): TownStats {
  const m = tickToMoment(tick)
  const agents = state === null ? [] : Object.values(state.agents)
  let alive = 0
  for (const a of agents) if (a.alive) alive += 1
  return { day: m.day, time: m.time, weather: state?.weather.kind ?? WEATHER_UNKNOWN, alive, total: agents.length }
}

// The living-documentary law as a regex the copy is tested against: no points, quests,
// leaderboards or progress meters, ever, anywhere in the chrome.
export const GAMIFICATION_BAN = /progress|score|level|quest|points|badge|streak|rank|xp\b/i

export type LensHint = { lens: Lens; count: number | null; hint: string }

// Counts for lenses whose readers land in later tasks (bonds, moments) arrive as an override
// rather than a null the strip has to special-case.
export type LensCounts = Partial<Record<Lens, number>>

export function lensHints(stats: TownStats, recentEvents: SimEvent[], counts: LensCounts = {}): LensHint[] {
  const base: Record<Lens, { count: number | null; hint: string }> = {
    map: { count: null, hint: 'Walk the town' },
    inspector: { count: stats.alive, hint: `Townsfolk (${stats.alive})` },
    chronicle: { count: recentEvents.length, hint: `Chronicle (${recentEvents.length})` },
    discoveries: { count: null, hint: 'What the townsfolk worked out for themselves' },
    society: { count: null, hint: 'Who the town has tied itself to' },
    director: { count: null, hint: 'The days the town kept' },
    laws: { count: null, hint: 'The rules the town lives under' },
  }
  return LENSES.map((lens) => ({ lens, count: counts[lens] ?? base[lens].count, hint: base[lens].hint }))
}

// ------------------------------------------------------------------ empty states

// Real empty states: each one says what the town has not done yet and why that is fine.
// Moments is defined here and rendered by Task 9, so the two cannot drift.
export const EMPTY_COPY = {
  roster: 'No one walks the town yet — the first footsteps are still to come.',
  rosterSub: 'The founders arrive at dawn.',
  chronicle: 'Day one is still unwritten. The town’s ledger fills as the townsfolk live it.',
  // The live feed holds what has arrived since you joined. On a town that is days old, saying
  // day one is unwritten is a lie about the world rather than a description of the feed.
  chronicleQuiet: 'Nothing has happened since you arrived. The whole record is under “What mattered”.',
  bonds: 'No bonds recorded yet — watch long enough and the town will braid its own ties.',
  moments: 'Nothing worth replaying yet — the first recorded day is still ahead.',
  discoveries: 'The town has not worked anything out yet.',
} as const

// ------------------------------------------------------------------ weather glyphs

// Palette hexes on an 8×8 pixel grid — the chrome speaks the world's own pixel language and
// never borrows an emoji, whose shape and colour belong to the reader's font, not the town.
export type WeatherGlyph = { label: string; pixels: ReadonlyArray<readonly [number, number, string]> }

const HONEY = '#F2C879', STONE = '#ABA198', WATER = '#7FB0C9', DEEP_WATER = '#5A8CAB', ICE = '#D6EAF2'

const CLOUD: ReadonlyArray<readonly [number, number, string]> = [
  [2, 1, STONE], [3, 1, STONE], [4, 1, STONE],
  [1, 2, STONE], [2, 2, STONE], [3, 2, STONE], [4, 2, STONE], [5, 2, STONE], [6, 2, STONE],
  [1, 3, STONE], [2, 3, STONE], [3, 3, STONE], [4, 3, STONE], [5, 3, STONE], [6, 3, STONE],
]

export const WEATHER_GLYPH: Record<string, WeatherGlyph> = {
  sunny: {
    label: 'clear sky',
    pixels: [
      [3, 1, HONEY], [4, 1, HONEY],
      [2, 2, HONEY], [3, 2, HONEY], [4, 2, HONEY], [5, 2, HONEY],
      [2, 3, HONEY], [3, 3, HONEY], [4, 3, HONEY], [5, 3, HONEY],
      [3, 4, HONEY], [4, 4, HONEY],
      [0, 2, HONEY], [7, 2, HONEY], [0, 3, HONEY], [7, 3, HONEY],
      [3, 6, HONEY], [4, 6, HONEY],
    ],
  },
  cloudy: { label: 'clouded over', pixels: CLOUD },
  rain: {
    label: 'rain',
    pixels: [...CLOUD, [2, 5, WATER], [4, 5, WATER], [6, 5, WATER], [2, 6, WATER], [4, 6, WATER], [6, 6, WATER]],
  },
  storm: {
    label: 'storm',
    pixels: [
      ...CLOUD.map(([x, y]) => [x, y, DEEP_WATER] as const),
      [4, 4, HONEY], [3, 5, HONEY], [4, 5, HONEY], [3, 6, HONEY],
    ],
  },
  snow: {
    label: 'snow',
    pixels: [...CLOUD, [2, 5, ICE], [5, 5, ICE], [3, 6, ICE], [6, 6, ICE]],
  },
  [WEATHER_UNKNOWN]: {
    label: 'the sky is not read yet',
    pixels: [[2, 3, STONE], [3, 3, STONE], [4, 3, STONE], [5, 3, STONE]],
  },
}

export function weatherGlyph(kind: string): WeatherGlyph {
  return WEATHER_GLYPH[kind] ?? WEATHER_GLYPH[WEATHER_UNKNOWN]!
}
