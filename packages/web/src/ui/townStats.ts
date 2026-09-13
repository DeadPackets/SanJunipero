import { tickToMoment } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { art } from './pixelArt.js'

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
  roster: 'Nobody is in town yet.',
  rosterSub: 'The founders arrive at dawn.',
  chronicle: 'Nothing written for today yet. It fills in as the day goes.',
  // The live feed holds what has arrived since you joined. On a town that is days old, saying
  // day one is unwritten is a lie about the world rather than a description of the feed.
  chronicleQuiet: 'Nothing new since you got here. Everything so far is under “What mattered”.',
  // Describes rather than promises: the scripted founders perform none of the six acts, so this
  // ledger can be permanently and correctly empty.
  bonds:
    'No bonds yet. Bonds come from what people do to each other: a word, a gift, a lesson, ' +
    'a blow, a partnership taken up, a child. None of that has happened here.',
  moments: 'Nothing to replay yet. The first day is not over.',
  discoveries: 'The town has not worked anything out yet.',
  // The read fold counts these four acts and nothing else, so a town of walkers is honestly empty.
  traffic: 'Nothing has passed between anyone yet. No word, no gift, no lesson, no blow.',
  paper: 'Nothing printed yet. The day gets written up once it ends.',
  firsts: 'No firsts yet. One gets added the night something happens for the first time.',
  families: 'No families yet. Nobody here was born to anyone else here.',
  places: 'Nothing stands here yet.',
  ties: 'No ties yet.',
  written: 'Nothing written yet.',
  biography: 'Nobody has written of them yet.',
  provenance: 'No one remembers who began this.',
  room: 'This one has no room to stand in.',
  noPlace: 'No place is picked.',
  noPerson: 'No one by that name.',
  admin:
    'The operator’s page. Nothing here is shown to a mind, and nothing here opens without ' +
    'the law channel’s key.',
} as const

// An empty state says what the TOWN has not done; this says what the WIRE has not carried.
// A refused read printing the empty copy asserts something false.
export const OUT_OF_REACH = {
  says: 'Can’t reach the town’s record right now. Nothing is missing, it just hasn’t loaded.',
  again: 'Look again',
} as const

// ------------------------------------------------------------------ weather glyphs

// Palette hexes on an 8×8 pixel grid — the chrome speaks the world's own pixel language and
// never borrows an emoji, whose shape and colour belong to the reader's font, not the town.
export type WeatherGlyph = {
  label: string
  pixels: readonly (readonly [number, number, string])[]
}

// The one cloud four skies share. The storm swaps its stone for deep water, nothing else.
const CLOUD = ['........', '..sss...', '.ssssss.', '.ssssss.']

export const WEATHER_GLYPH: Record<string, WeatherGlyph> = {
  sunny: {
    label: 'clear sky',
    pixels: art('........', '...hh...', 'h.hhhh.h', 'h.hhhh.h', '...hh...', '........', '...hh...'),
  },
  cloudy: { label: 'clouded over', pixels: art(...CLOUD) },
  rain: { label: 'rain', pixels: art(...CLOUD, '........', '..w.w.w.', '..w.w.w.') },
  storm: {
    label: 'storm',
    pixels: art(
      ...CLOUD.map((row) => row.replaceAll('s', 'b')),
      '....h...',
      '...hh...',
      '...h....',
    ),
  },
  snow: { label: 'snow', pixels: art(...CLOUD, '........', '..c..c..', '...c..c.') },
  [WEATHER_UNKNOWN]: {
    label: 'the sky is not read yet',
    pixels: art('........', '........', '........', '..ssss..'),
  },
}
