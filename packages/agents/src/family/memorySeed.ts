import type { EventStore } from '@sj/engine/store'

export type SeedEntry = { text: string; importance: number; tags: string[] }

export type HouseholdSeedOpts = {
  childId: string
  motherId: string
  fatherId: string
  homeStructureId: string
  upToTick: number
  max?: number
}

export const DEFAULT_HOUSEHOLD_SEED_MAX = 40

type Ctx = HouseholdSeedOpts & { relation: (id: string) => 'mother' | 'father' | null }

// Second-hand by construction: the child was not there, so nothing is ever in a
// parent's first person, and nothing comes from anywhere but the world's own log.
function who(ctx: Ctx, id: string, capital: boolean): string {
  const rel = ctx.relation(id)
  const s = rel === null ? 'someone' : `your ${rel}`
  return capital ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s
}

type Phrased = { text: string; importance: number; tags: string[] }

const strOf =
  (p: Record<string, unknown>) =>
  (k: string): string => {
    const v = p[k]
    return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
  }
const home = (ctx: Ctx, id: string): boolean => id === ctx.homeStructureId
const kin = (ctx: Ctx, id: string): boolean => ctx.relation(id) !== null

type Say = (p: Record<string, unknown>, ctx: Ctx) => Phrased | null

// The authored table, and the only event types a seeding reads: a type absent from it is not part
// of what a newborn is told, and nothing here invents a happening the log does not carry.
const PHRASINGS: Readonly<Record<string, Say>> = {
  structure_planned: (p, ctx) => {
    const str = strOf(p)
    if (home(ctx, str('id')))
      return { text: 'The house you were born in was begun.', importance: 5, tags: ['home'] }
    if (!kin(ctx, str('builderId'))) return null
    return {
      text: `${who(ctx, str('builderId'), true)} set out to raise a ${str('kind')}.`,
      importance: 4,
      tags: [ctx.relation(str('builderId'))!],
    }
  },
  structure_completed: (p, ctx) =>
    home(ctx, strOf(p)('id'))
      ? { text: 'The house you were born in was finished.', importance: 6, tags: ['home'] }
      : null,
  structure_inscribed: (p, ctx) => {
    const str = strOf(p)
    return home(ctx, str('structureId'))
      ? {
          text: `Words are cut into the house you were born in: “${str('text')}”`,
          importance: 6,
          tags: ['home', ...(kin(ctx, str('agentId')) ? [ctx.relation(str('agentId'))!] : [])],
        }
      : null
  },
  agent_spoke: (p, ctx) => {
    const str = strOf(p)
    return kin(ctx, str('agentId'))
      ? {
          text: `${who(ctx, str('agentId'), true)} was heard to say: “${str('text')}”`,
          importance: 5,
          tags: [ctx.relation(str('agentId'))!],
        }
      : null
  },
  item_spawned: (p, ctx) => {
    const str = strOf(p)
    return kin(ctx, str('owner'))
      ? {
          text: `${who(ctx, str('owner'), true)} came by a ${str('kind')}.`,
          importance: 3,
          tags: [ctx.relation(str('owner'))!],
        }
      : null
  },
  item_moved: (p, ctx) => {
    const loc = p.loc as { t?: string; id?: string } | undefined
    return loc?.t === 'structure' && loc.id === ctx.homeStructureId
      ? {
          text: 'Something was set down inside the house you were born in.',
          importance: 2,
          tags: ['home'],
        }
      : null
  },
  item_taken: (p, ctx) => {
    const str = strOf(p)
    return kin(ctx, str('takerId')) || kin(ctx, str('ownerId'))
      ? {
          text: `${who(ctx, str('takerId'), true)} was seen taking a ${str('kind')} that was ${who(ctx, str('ownerId'), false)}.`,
          importance: 6,
          tags: [str('takerId'), str('ownerId')].flatMap((id) =>
            kin(ctx, id) ? [ctx.relation(id)!] : [],
          ),
        }
      : null
  },
  agent_born: (p, ctx) => {
    const str = strOf(p)
    if (str('id') === ctx.childId)
      return {
        text: 'You were born to your mother and your father, in this town.',
        importance: 10,
        tags: ['mother', 'father'],
      }
    return kin(ctx, str('motherId')) || kin(ctx, str('fatherId'))
      ? {
          text: 'Another child was born to your household before you.',
          importance: 8,
          tags: ['mother', 'father'],
        }
      : null
  },
  agent_died: (p, ctx) => {
    const str = strOf(p)
    return kin(ctx, str('agentId'))
      ? {
          text: `${who(ctx, str('agentId'), true)} died.`,
          importance: 10,
          tags: [ctx.relation(str('agentId'))!],
        }
      : null
  },
}

/** The log is read one type at a time, so a seeding never parses the 99.5% of it —
 *  `agent_moved`, `need_changed` — that this table has no words for. */
export const SEED_TYPES: readonly string[] = Object.keys(PHRASINGS)

// The public record of the household, never a line of a parent's own memory store: per-agent
// isolation is a law, so this reads the event log and only that.
export function buildHouseholdSeed(store: EventStore, opts: HouseholdSeedOpts): SeedEntry[] {
  const ctx: Ctx = {
    ...opts,
    relation: (id) => (id === opts.motherId ? 'mother' : id === opts.fatherId ? 'father' : null),
  }
  const window = SEED_TYPES.flatMap((t) => store.readTypeFrom(0, t))
    .filter((ev) => ev.tick <= opts.upToTick)
    .sort((a, b) => a.seq - b.seq)
  const out: SeedEntry[] = []
  for (const ev of window) {
    const said = PHRASINGS[ev.type]!(ev.payload as Record<string, unknown>, ctx)
    if (said === null) continue
    out.push({
      text: said.text,
      importance: said.importance,
      tags: [...new Set(['household', `event:${ev.seq}`, ...said.tags])],
    })
  }
  const max = opts.max ?? DEFAULT_HOUSEHOLD_SEED_MAX
  return out.length <= max ? out : out.slice(out.length - max)
}
