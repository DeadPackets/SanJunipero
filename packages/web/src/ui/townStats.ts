import { tickToMoment } from '@sj/shared'
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

/**
 * ★ A BADGE COUNTS THE SURFACE IT BADGES, OR IT COUNTS NOTHING — and every lens has to say
 * which, because this went wrong by silence once already.
 *
 * `chronicle` used to be badged with `recentEvents.length`: the LIVE SOCKET FEED, what has
 * arrived since the viewer joined. The panel behind that tab lists `/api/chronicle`, the whole
 * record. On a town that is days old the feed is empty and the record is not, so the first
 * screen a viewer meets said `CHRONICLE 0` over sixteen entries — the nav telling them the
 * simulation was doing nothing while it was visibly doing something.
 *
 * So this is TOTAL, with a written reason per row, exactly as `MINIMAP_LENSES` was made total
 * for the same class of bug: the next surface anybody adds is a type error until it decides
 * where its number comes from, and "the number I happen to have in hand" is no longer reachable.
 */
export type LensCounts = Record<Lens, number | null>

/** What the viewer can count without asking the server: the living, and nothing else. The two
 *  that have a real number — the chronicle and the bonds — are fetched from the very endpoints
 *  their own panels read, and `LensTabs` lays them over this. */
export const countsFromWorld = (stats: TownStats): LensCounts => ({
  map: null,          // the map IS the town; a number stuck on it would be a score
  inspector: stats.alive,   // the living, straight out of the state the viewer already holds
  chronicle: null,    // the size of the RECORD, and only /api/chronicle knows it
  discoveries: null,  // no count offered: the panel's own empty state says it better
  society: null,      // /api/bonds, the same endpoint the roster and the society lens read
  director: null,     // no count offered
  laws: null,         // a rule count is machinery, not a thing to show a viewer
})

/**
 * ★ THE BADGES A VIEWER ACTUALLY SEES — the world's own count, with the two that come off the
 * wire laid over it. A pure function rather than a line inside the component, because the line
 * inside the component was the one thing no test could reach: a mutation that dropped both
 * fetched counts on the floor left every UI test green while the nav went back to reading
 * `CHRONICLE ·` on a town with sixteen entries in the record.
 *
 * `null` from either endpoint means it has not answered yet, and no badge is better than a
 * wrong one — the same rule `useRemoteCount`'s catch already follows.
 */
export function lensCountsFor(
  stats: TownStats, chronicle: number | null, bonds: number | null,
): LensCounts {
  return { ...countsFromWorld(stats), chronicle, society: bonds }
}

/**
 * ★ TWO NUMBERS ON ONE BUTTON, AND THEY DISAGREED.
 *
 * A LENS TAB CARRIES A COUNT AND A HINT, and the hint is the button's `aria-label` AND its
 * `title`. The badge itself is rendered `aria-hidden`, so the hint is the only place a screen
 * reader or a hovering pointer can learn the number. Two things were wrong with that:
 *
 *  · `chronicle` defaulted its count to `recentEvents.length` — the ring of what has arrived
 *    SINCE YOU JOINED, which is the panel's SECOND tab. The panel opens on "What mattered",
 *    the curated record from `/api/chronicle`, so a town two hours old showed `CHRONICLE 0`
 *    beside a list of eleven finished buildings, both on screen at once. The ring is the wrong
 *    shape for a badge whatever tab is open: it is capped, so the number plateaus at the cap
 *    and stops meaning anything. `StatusStrip` now supplies the ledger's own length, and until
 *    it answers there is no badge at all — no badge is better than a wrong one.
 *
 *  · and the hint was a FIXED STRING built beside a count an override could then replace, so
 *    the label and the badge could name different numbers. `Bonds` showed a visible 3 under a
 *    label that read *"Who the town has tied itself to"* and never said three at all.
 *
 * So the count is resolved FIRST and the hint is a function of it. Two tables, because a lens
 * with a number and a lens without one are different sentences in English; one loop, because
 * "a badged lens speaks its badge" is a law and not a per-lens decision.
 */

/** What each lens says when it has nothing to count. The VIEW already prefixes the lens's own
 *  name, so a hint never repeats it. */
const LENS_PROSE: Record<Lens, string> = {
  map: 'Walk the town',
  inspector: 'Who is walking the town',
  chronicle: 'The town’s own ledger',
  discoveries: 'What the townsfolk worked out for themselves',
  society: 'Who the town has tied itself to',
  director: 'The days the town kept',
  laws: 'The rules the town lives under',
}

/** And what it says when it has. The phrasing is per lens because English is; the LAW — that
 *  a badged lens speaks its badge — is the loop below and the test that walks it. */
const LENS_COUNTED: Partial<Record<Lens, (n: number) => string>> = {
  inspector: (n) => `${n} walking the town`,
  chronicle: (n) => `${n} in the town’s own ledger`,
  society: (n) => `${n} ties the town has made`,
  director: (n) => `${n} days the town kept`,
}

export function lensHints(stats: TownStats, counts: LensCounts = countsFromWorld(stats)): LensHint[] {
  // Only `inspector` knows its own number: the cast is in the snapshot. Every other count is
  // history and arrives as an override, or does not arrive and is not badged.
  const own: Partial<Record<Lens, number>> = { inspector: stats.alive }
  return LENSES.map((lens) => {
    const count = counts[lens] ?? own[lens] ?? null
    const counted = count === null ? undefined : LENS_COUNTED[lens]?.(count)
    return { lens, count, hint: counted ?? LENS_PROSE[lens] }
  })
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
  // ★ IT USED TO PROMISE, AND IN THE DEV WORLD THE PROMISE WAS FALSE. "Watch long enough and
  // the town will braid its own ties" is not true of a world whose cast cannot form one:
  // `buildBonds` derives every tie from six acts, and the scripted founders perform none of
  // them, so the ledger is permanently and correctly empty. A demo surface may show an empty
  // ledger; it may not tell a viewer to wait for something that will never arrive. The copy
  // DESCRIBES now — and describing is exactly true whenever this panel is on screen, because
  // a bond count of zero IS "none of those six things has been recorded".
  bonds: 'No bonds yet. A town braids its ties out of what people do to one another — a word, '
    + 'a gift, a lesson, a blow, a night under one roof, a child — and none of that is in the '
    + 'record here.',
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
