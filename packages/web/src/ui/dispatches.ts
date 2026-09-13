/** The gateway sends six flat lists (`/api/dispatches`); this folds them into one edition
 *  per recorded day, newest first. */

export type DispatchesFeed = {
  papers: readonly { day: number; title: string; body: string }[]
  captions: readonly { day: number; caption: string }[]
  biographies: readonly { subjectId: string; day: number; title: string; body: string }[]
  eras: readonly { startDay: number; endDay: number; title: string; text: string }[]
  institutions: readonly {
    day: number
    kind: string
    name: string
    description: string
    memberIds: readonly string[]
  }[]
  /** The five parts arrive together or not at all: an older gateway sends the total alone. */
  heat: readonly {
    day: number
    total: number
    conflict?: number
    novelty?: number
    firsts?: number
    stakes?: number
    dramaticIrony?: number
  }[]
}

export const EMPTY_DISPATCHES: DispatchesFeed = {
  papers: [],
  captions: [],
  biographies: [],
  eras: [],
  institutions: [],
  heat: [],
}

/** The members come off the narrator's table as the JSON array it stores, so they are read
 *  here rather than at every call site that wants to know who is in a thing. */
function memberIds(v: unknown): string[] {
  const raw: unknown = typeof v === 'string' ? safeParse(v) : v
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []
}
const safeParse = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Every list is optional on the wire; a table the narrator has nothing in is an empty one. */
export function dispatchesFrom(body: unknown): DispatchesFeed {
  const b = body as Partial<DispatchesFeed> | null
  return {
    papers: b?.papers ?? [],
    captions: b?.captions ?? [],
    biographies: b?.biographies ?? [],
    eras: b?.eras ?? [],
    institutions: (b?.institutions ?? []).map((i) => ({ ...i, memberIds: memberIds(i.memberIds) })),
    heat: b?.heat ?? [],
  }
}

export type Edition = {
  day: number
  title: string
  body: string
  caption: string | null
  /** What the day felt like, from the hottest scene the narrator scored. Null where none was. */
  temper: string | null
  era: { title: string; text: string } | null
  formed: readonly { name: string; description: string }[]
}

/** The narrator's own marker threshold — a scene at or over it is why the day is worth reading. */
export const LOUD_HEAT = 6
const STIRRING_HEAT = 3

export function temperOf(total: number): string {
  if (total >= LOUD_HEAT) return 'a loud day'
  if (total >= STIRRING_HEAT) return 'a day with something in it'
  return 'a quiet day'
}

/** What the day's hottest scene was made of, in the narrator's own five columns. The word is
 *  what a reader sees, the key never is. */
export const HEAT_SPOKES = [
  ['conflict', 'conflict'],
  ['novelty', 'novelty'],
  ['firsts', 'firsts'],
  ['stakes', 'stakes'],
  ['dramaticIrony', 'irony'],
] as const

export type HeatSpoke = { words: string; share: number }

/** Each part over the total the gateway called the same scene, so nothing here is a bare score.
 *  Null where the day was never scored, scored at nothing, or read off a gateway that still
 *  sends the total alone. */
export function heatSpokes(feed: DispatchesFeed, day: number): HeatSpoke[] | null {
  const row = feed.heat.find((h) => h.day === day)
  if (row === undefined || row.total <= 0) return null
  const out: HeatSpoke[] = []
  for (const [key, words] of HEAT_SPOKES) {
    const part = row[key]
    if (typeof part !== 'number' || !Number.isFinite(part)) return null
    out.push({ words, share: Math.min(1, Math.max(0, part / row.total)) })
  }
  return out
}

export function editions(feed: DispatchesFeed): Edition[] {
  const caption = new Map(feed.captions.map((c) => [c.day, c.caption]))
  const heat = new Map(feed.heat.map((h) => [h.day, h.total]))
  const era = new Map(feed.eras.map((e) => [e.endDay, e]))
  const formed = new Map<number, { name: string; description: string }[]>()
  for (const i of feed.institutions) {
    const on = formed.get(i.day) ?? []
    on.push({ name: i.name, description: i.description })
    formed.set(i.day, on)
  }
  return [...feed.papers]
    .sort((a, b) => b.day - a.day)
    .map((p) => {
      const total = heat.get(p.day)
      const week = era.get(p.day)
      return {
        day: p.day,
        title: p.title,
        body: p.body,
        caption: caption.get(p.day) ?? null,
        temper: total === undefined ? null : temperOf(total),
        era: week === undefined ? null : { title: week.title, text: week.text },
        formed: formed.get(p.day) ?? [],
      }
    })
}

export function biographyOf(
  feed: DispatchesFeed,
  agentId: string,
): { day: number; title: string; body: string } | null {
  let best: { day: number; title: string; body: string } | null = null
  for (const b of feed.biographies) {
    if (b.subjectId !== agentId) continue
    if (best === null || b.day > best.day) best = { day: b.day, title: b.title, body: b.body }
  }
  return best
}
