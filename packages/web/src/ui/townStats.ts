import { tickToMoment } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

export type TownStats = { day: number; time: string; weather: string; alive: number; total: number }

const WEATHER_UNKNOWN = '—'

export function townStats(state: WorldState | null, tick: number): TownStats {
  const m = tickToMoment(tick)
  const agents = state === null ? [] : Object.values(state.agents)
  let alive = 0
  for (const a of agents) if (a.alive) alive += 1
  return {
    day: m.day,
    time: m.time,
    weather: state?.weather.kind ?? WEATHER_UNKNOWN,
    alive,
    total: agents.length,
  }
}

// The living-documentary law as a regex the copy is tested against: no points, quests,
// leaderboards or progress meters, ever, anywhere in the chrome.
export const GAMIFICATION_BAN = /progress|score|level|quest|points|badge|streak|rank|xp\b/i

// ------------------------------------------------------------------ empty states

// Real empty states: each one says what the town has not done yet and why that is fine.
// Moments is defined here and rendered by Task 9, so the two cannot drift.
export const EMPTY_COPY = {
  roster: 'No one walks the town yet — the first footsteps are still to come.',
  rosterSub: 'The founders arrive at dawn.',
  chronicle: 'Day one is still unwritten. The town’s ledger fills as the townsfolk live it.',
  // The live feed holds what has arrived since you joined. On a town that is days old, saying
  // day one is unwritten is a lie about the world rather than a description of the feed.
  chronicleQuiet:
    'Nothing has happened since you arrived. The whole record is under “What mattered”.',
  // Describes rather than promises: the scripted founders perform none of the six acts, so this
  // ledger can be permanently and correctly empty.
  bonds:
    'No bonds yet. A town braids its ties out of what people do to one another — a word, ' +
    'a gift, a lesson, a blow, a night under one roof, a child — and none of that is in the ' +
    'record here.',
  moments: 'Nothing worth replaying yet — the first recorded day is still ahead.',
  discoveries: 'The town has not worked anything out yet.',
  // The read fold counts these four acts and nothing else, so a town of walkers is honestly empty.
  traffic:
    'Nothing has passed between anyone yet — no word within earshot, no gift, no lesson, no blow.',
  paper: 'Nothing printed yet. The chronicler writes a day up once it has closed.',
  firsts: 'No firsts yet. The chronicler adds one the night a thing happens for the first time.',
  families: 'No families yet — nobody walking the town was born to anyone in it.',
  places: 'Nothing stands here yet.',
  ties: 'No ties yet.',
  written: 'Nothing written yet.',
  biography: 'Nobody has written of them yet.',
  provenance: 'No one remembers who began this.',
  room: 'This one has no room to stand in.',
  noPlace: 'No place is picked.',
  noPerson: 'No such townsfolk.',
  admin:
    'The operator’s page. Nothing here is shown to a mind, and nothing here opens without ' +
    'the law channel’s key.',
} as const

// An empty state says what the TOWN has not done; this says what the WIRE has not carried.
// A refused read printing the empty copy asserts something false.
export const OUT_OF_REACH = {
  says: 'The town’s record is out of reach. Nothing here is missing — it has not been read.',
  again: 'Look again',
} as const

// ------------------------------------------------------------------ weather glyphs

// Palette hexes on an 8×8 pixel grid — the chrome speaks the world's own pixel language and
// never borrows an emoji, whose shape and colour belong to the reader's font, not the town.
export type WeatherGlyph = {
  label: string
  pixels: readonly (readonly [number, number, string])[]
}

const HONEY = '#F2C879',
  STONE = '#ABA198',
  WATER = '#7FB0C9',
  DEEP_WATER = '#5A8CAB',
  ICE = '#D6EAF2'

const CLOUD: readonly (readonly [number, number, string])[] = [
  [2, 1, STONE],
  [3, 1, STONE],
  [4, 1, STONE],
  [1, 2, STONE],
  [2, 2, STONE],
  [3, 2, STONE],
  [4, 2, STONE],
  [5, 2, STONE],
  [6, 2, STONE],
  [1, 3, STONE],
  [2, 3, STONE],
  [3, 3, STONE],
  [4, 3, STONE],
  [5, 3, STONE],
  [6, 3, STONE],
]

export const WEATHER_GLYPH: Record<string, WeatherGlyph> = {
  sunny: {
    label: 'clear sky',
    pixels: [
      [3, 1, HONEY],
      [4, 1, HONEY],
      [2, 2, HONEY],
      [3, 2, HONEY],
      [4, 2, HONEY],
      [5, 2, HONEY],
      [2, 3, HONEY],
      [3, 3, HONEY],
      [4, 3, HONEY],
      [5, 3, HONEY],
      [3, 4, HONEY],
      [4, 4, HONEY],
      [0, 2, HONEY],
      [7, 2, HONEY],
      [0, 3, HONEY],
      [7, 3, HONEY],
      [3, 6, HONEY],
      [4, 6, HONEY],
    ],
  },
  cloudy: { label: 'clouded over', pixels: CLOUD },
  rain: {
    label: 'rain',
    pixels: [
      ...CLOUD,
      [2, 5, WATER],
      [4, 5, WATER],
      [6, 5, WATER],
      [2, 6, WATER],
      [4, 6, WATER],
      [6, 6, WATER],
    ],
  },
  storm: {
    label: 'storm',
    pixels: [
      ...CLOUD.map(([x, y]) => [x, y, DEEP_WATER] as const),
      [4, 4, HONEY],
      [3, 5, HONEY],
      [4, 5, HONEY],
      [3, 6, HONEY],
    ],
  },
  snow: {
    label: 'snow',
    pixels: [...CLOUD, [2, 5, ICE], [5, 5, ICE], [3, 6, ICE], [6, 6, ICE]],
  },
  [WEATHER_UNKNOWN]: {
    label: 'the sky is not read yet',
    pixels: [
      [2, 3, STONE],
      [3, 3, STONE],
      [4, 3, STONE],
      [5, 3, STONE],
    ],
  },
}
