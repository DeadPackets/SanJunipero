/**
 * Marks come from the RECORD — the world's own event log and the narrator's tables — never from
 * `store.recentEvents()`, a 400-entry ring holding only what arrived since the viewer connected.
 */

export const MARK_KINDS = [
  'death',
  'birth',
  'built',
  'first',
  'chapter',
  'changed',
  'quarrel',
  'joined',
  'discovery',
] as const
export type MarkKind = (typeof MARK_KINDS)[number]

export type Mark = { tick: number; kind: MarkKind; words: string; weight: number }

/** `discovery` sits above the old ceiling on two arguments: it is rarer than every other kind, so a
 *  high weight costs them almost nothing, and it is the only PERMANENT one. */
export const MARK_WEIGHT: Readonly<Record<MarkKind, number>> = {
  discovery: 18,
  changed: 16,
  first: 16,
  death: 14,
  birth: 14,
  joined: 12,
  quarrel: 12,
  chapter: 10,
  built: 8,
}
export const MARK_MIN_WEIGHT = 8

/** At most one mark per this many ticks per kind, so a busy day is a mark and not a smear. */
export const MARK_COALESCE_TICKS = 60

/** A mark is a 24px target on a track a viewer can reach across. Past this many, marks stop
 *  being distinguishable and start being texture, so the window widens instead. */
export const MARK_SLOTS = 48

export const MARK_GLYPH_PX = 7
/** Pixel art is scaled by whole numbers or it is resampled. 3× puts a 7px mark at 21px inside
 *  a 26px target — big enough to tell a roof from a headstone. */
export const MARK_GLYPH_SCALE = 3
export const MARK_HIT_PX = 26

/** A mark at tick 0 is centred on the track's first pixel, so half of it drew outside the slab.
 *  Clamped, the extremes stay whole and every mark between them keeps its true position. */
export function markPercent(tick: number, span: number): number {
  return span <= 0 ? 0 : Math.min(100, Math.max(0, (tick * 100) / span))
}

export function markLeft(tick: number, span: number): string {
  const half = MARK_HIT_PX / 2
  return `clamp(${half}px, ${markPercent(tick, span)}%, calc(100% - ${half}px))`
}

/** WHAT THE BROWSER CAUGHT, TWICE: a tip centred on the first mark ran off the left of the
 *  viewport and lost its first three words. A tip hangs from whichever side keeps it whole. */
export const TIP_EDGE_PERCENT = 18
export type TipSide = 'start' | 'center' | 'end'
export function tipSide(tick: number, span: number): TipSide {
  const pct = markPercent(tick, span)
  if (pct < TIP_EDGE_PERCENT) return 'start'
  if (pct > 100 - TIP_EDGE_PERCENT) return 'end'
  return 'center'
}

const DEEP = '#241F2B',
  HONEY = '#F2C879',
  SAGE = '#93B573',
  WATER = '#7FB0C9'
const ROSE = '#C47876',
  EMBER = '#E8785A',
  INK = '#43394A'

/** Every fill a mark may use — all MASTER_PALETTE members, asserted as a set. */
export const MARK_GLYPH_PALETTE: readonly string[] = [DEEP, HONEY, SAGE, WATER, ROSE, EMBER, INK]

/** Only these clear 3:1 on the sand track (7.63 and 11.24). Nothing else may carry a mark's
 *  SHAPE; the warm hues are interior detail, and a mark is legible with them taken away. */
export const MARK_STRUCTURE_INKS: readonly string[] = [INK, DEEP]

export type MarkPixel = readonly [number, number, string]

const KEY: Readonly<Record<string, string>> = {
  d: DEEP,
  h: HONEY,
  g: SAGE,
  w: WATER,
  r: ROSE,
  e: EMBER,
  i: INK,
}

/** Seven rows of seven characters: `.` is empty. Written as pictures, because a table of
 *  coordinates is a picture nobody can read. */
function art(...rows: string[]): MarkPixel[] {
  const out: MarkPixel[] = []
  rows.forEach((row, y) => {
    // by code unit, not code point: x is the column in a fixed-width ASCII grid
    for (let x = 0; x < row.length; x++) {
      const fill = KEY[row.charAt(x)]
      if (fill !== undefined) out.push([x, y, fill] as const)
    }
  })
  return out
}

/** Shape carries the kind, colour only reinforces it — two marks are told apart with the
 *  colour taken away. */
export const MARK_GLYPH: Readonly<Record<MarkKind, MarkPixel[]>> = {
  // a headstone
  death: art('..iii..', '.iiiii.', '.iidii.', '.iidii.', '.iidii.', '.iidii.', 'iiiiiii'),
  // a sprout, two leaves on a stem
  birth: art('.i...i.', 'igi.igi', '.igigi.', '..iii..', '...i...', '...i...', '.iiiii.'),
  // a roof over two windows
  built: art('...i...', '..iii..', '.iiiii.', 'iiiiiii', '.iiiii.', '.ihihi.', '.iiiii.'),
  // a cut diamond — the narrator's own "first"
  first: art('...i...', '..iii..', '.iieii.', 'iieeeii', '.iieii.', '..iii..', '...i...'),
  // an open book
  chapter: art('.i...i.', 'iwiiiwi', 'iwiiiwi', 'iwiiiwi', 'iwiiiwi', 'iwiiiwi', '.iiiii.'),
  // a turn — the day somebody became different
  changed: art('.iiiii.', 'ii.r.ii', 'ii.....', '.iiiii.', '.....ii', 'ii.r.ii', '.iiiii.'),
  // two strokes crossing
  quarrel: art('ii...ii', 'iii.iii', '.iiiii.', '..iii..', '.iiiii.', 'iii.iii', 'ii...ii'),
  // an arrival: an arrow coming down onto the ground
  joined: art('...i...', '...i...', '.iiiii.', '..iii..', '...i...', '.......', 'iiiiiii'),
  // a key — the day a door opened. HONEY is the ward; INK carries the whole silhouette, so the
  // shape survives the colour being taken away (7.63:1 on the sand track).
  discovery: art('..iii..', '.ii.ii.', '.ii.ii.', '..iii..', '...i...', '...ihi.', '...ih..'),
}

// ── the sources ───────────────────────────────────────────────────────────────────────────

/** What the world log records that the town would remember, and what to call it. */
const EVENT_MARK: Readonly<Record<string, MarkKind>> = {
  agent_died: 'death',
  agent_born: 'birth',
  agent_spawned: 'joined',
  agent_injured: 'quarrel',
  structure_completed: 'built',
}

/** One phrase for one of a thing, one for several. `n` is filled in by the coalescer. */
export const MARK_WORDS: Readonly<Record<MarkKind, { one: string; many: (n: number) => string }>> =
  {
    death: { one: 'Someone died', many: (n) => `${n} people died` },
    birth: { one: 'A child was born', many: (n) => `${n} children were born` },
    built: { one: 'A building was finished', many: (n) => `${n} buildings were finished` },
    joined: { one: 'Someone arrived in the town', many: (n) => `${n} people arrived in the town` },
    quarrel: { one: 'A quarrel', many: (n) => `${n} quarrels` },
    changed: { one: 'Someone changed', many: (n) => `${n} people changed` },
    // these two carry the narrator's own words, so the fallback is only ever a safety net
    first: { one: 'Something happened for the first time', many: (n) => `${n} firsts` },
    chapter: { one: 'A day the town kept', many: (n) => `${n} days the town kept` },
    // carries the gateway's own credited words, so the fallback is only ever a safety net
    discovery: {
      one: 'Somebody worked something out',
      many: (n) => `${n} things were worked out`,
    },
  }

export type MarkSources = {
  chapters: readonly { day: number; title: string }[]
  milestones: readonly { label: string; day: number; tick: number }[]
  /** A narrated scene. A day the narrator kept but never titled still deserves a mark. */
  moments: readonly { day: number; startTick: number }[]
  /** The days a personality document actually moved — Task 83's change log. */
  changes: readonly { tick: number }[]
  /** The world's own log. Anything not in EVENT_MARK is noise here. */
  events: readonly { tick: number; type: string }[]
  /** Already credited and already prose — the gateway owns the sentence, because only the
   *  gateway can turn an agent id into a name. */
  discoveries: readonly { tick: number; words: string }[]
}

const MINUTES_PER_DAY = 1440

export function marksFrom(sources: MarkSources): Mark[] {
  const out: Mark[] = []
  const push = (tick: number, kind: MarkKind, words?: string): void => {
    out.push({ tick, kind, words: words ?? MARK_WORDS[kind].one, weight: MARK_WEIGHT[kind] })
  }

  const titledDays = new Set<number>()
  for (const c of sources.chapters) {
    titledDays.add(c.day)
    push(c.day * MINUTES_PER_DAY, 'chapter', c.title)
  }
  // A scene the narrator kept without a chapter is still a day worth aiming at; a scene on a
  // day that HAS a chapter is the same day, and must not be marked twice.
  for (const m of sources.moments) {
    if (titledDays.has(m.day)) continue
    titledDays.add(m.day)
    push(m.startTick, 'chapter', `Day ${m.day}`)
  }
  for (const m of sources.milestones) push(m.tick, 'first', m.label)
  for (const c of sources.changes) push(c.tick, 'changed')
  for (const d of sources.discoveries) push(d.tick, 'discovery', d.words)
  for (const ev of sources.events) {
    const kind = EVENT_MARK[ev.type]
    if (kind !== undefined) push(ev.tick, kind)
  }

  out.sort((a, b) => a.tick - b.tick || b.weight - a.weight || a.kind.localeCompare(b.kind))
  return out
}

// ── coalescing ────────────────────────────────────────────────────────────────────────────

/** The tick width one mark occupies on the track. On a short span that is the fixed window;
 *  on a long one the track runs out of room first. */
function windowFor(span: number): number {
  return Math.max(MARK_COALESCE_TICKS, Math.ceil(Math.max(0, span) / MARK_SLOTS))
}

export function coalesceMarks(marks: readonly Mark[], span: number): Mark[] {
  if (marks.length === 0) return []
  const gap = windowFor(span)

  // 1. Per kind, a run of the same thing inside one window is ONE mark that says how many.
  const perKind: Mark[] = []
  for (const kind of MARK_KINDS) {
    const of = marks.filter((m) => m.kind === kind).sort((a, b) => a.tick - b.tick)
    let i = 0
    while (i < of.length) {
      const first = of[i]!
      let j = i + 1
      while (j < of.length && of[j]!.tick - first.tick < gap) j++
      const n = j - i
      perKind.push(n === 1 ? first : { ...first, words: MARK_WORDS[kind].many(n) })
      i = j
    }
  }

  // 2. Across kinds, two marks that would draw on the same pixel leave the heavier one —
  //    P22.5, so a day somebody changed survives a day a wall went up.
  perKind.sort((a, b) => a.tick - b.tick || b.weight - a.weight || a.kind.localeCompare(b.kind))
  const out: Mark[] = []
  for (const m of perKind) {
    const prev = out[out.length - 1]
    if (prev !== undefined && m.tick - prev.tick < gap) {
      if (m.weight > prev.weight) out[out.length - 1] = m
      continue
    }
    out.push(m)
  }
  return out
}
