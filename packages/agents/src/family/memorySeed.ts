import type { EventStore } from '@sj/engine'
import type { SimEvent } from '@sj/shared'

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

// The authored table. An event type absent from it is simply not part of what a
// newborn is told; nothing here invents a happening the log does not carry.
function phrase(ev: SimEvent, ctx: Ctx): Phrased | null {
  const p = ev.payload as Record<string, unknown>
  const str = (k: string): string => String(p[k] ?? '')
  const home = (id: string): boolean => id === ctx.homeStructureId
  const kin = (id: string): boolean => ctx.relation(id) !== null

  switch (ev.type) {
    case 'structure_planned': {
      if (home(str('id'))) {
        return { text: 'The house you were born in was begun.', importance: 5, tags: ['home'] }
      }
      if (!kin(str('builderId'))) return null
      return {
        text: `${who(ctx, str('builderId'), true)} set out to raise a ${str('kind')}.`,
        importance: 4,
        tags: [ctx.relation(str('builderId'))!],
      }
    }
    case 'structure_completed':
      return home(str('id')) ? { text: 'The house you were born in was finished.', importance: 6, tags: ['home'] } : null
    case 'structure_inscribed':
      return home(str('structureId'))
        ? {
            text: `Words are cut into the house you were born in: “${str('text')}”`,
            importance: 6,
            tags: ['home', ...(kin(str('agentId')) ? [ctx.relation(str('agentId'))!] : [])],
          }
        : null
    case 'agent_spoke':
      return kin(str('agentId'))
        ? {
            text: `${who(ctx, str('agentId'), true)} was heard to say: “${str('text')}”`,
            importance: 5,
            tags: [ctx.relation(str('agentId'))!],
          }
        : null
    case 'item_spawned':
      return kin(str('owner'))
        ? {
            text: `${who(ctx, str('owner'), true)} came by a ${str('kind')}.`,
            importance: 3,
            tags: [ctx.relation(str('owner'))!],
          }
        : null
    case 'item_moved': {
      const loc = p.loc as { t?: string; id?: string } | undefined
      return loc?.t === 'structure' && loc.id === ctx.homeStructureId
        ? { text: 'Something was set down inside the house you were born in.', importance: 2, tags: ['home'] }
        : null
    }
    case 'item_taken':
      return kin(str('takerId')) || kin(str('ownerId'))
        ? {
            text: `${who(ctx, str('takerId'), true)} was seen taking a ${str('kind')} that was ${who(ctx, str('ownerId'), false)}.`,
            importance: 6,
            tags: [str('takerId'), str('ownerId')].flatMap((id) => (kin(id) ? [ctx.relation(id)!] : [])),
          }
        : null
    case 'agent_born': {
      if (str('id') === ctx.childId) {
        return { text: 'You were born to your mother and your father, in this town.', importance: 10, tags: ['mother', 'father'] }
      }
      return kin(str('motherId')) || kin(str('fatherId'))
        ? { text: 'Another child was born to your household before you.', importance: 8, tags: ['mother', 'father'] }
        : null
    }
    case 'agent_died':
      return kin(str('agentId'))
        ? { text: `${who(ctx, str('agentId'), true)} died.`, importance: 10, tags: [ctx.relation(str('agentId'))!] }
        : null
    default:
      return null
  }
}

// The public record of the household, never a line of a parent's own memory store: per-agent
// isolation is a law, so this reads the event log and only that.
export function buildHouseholdSeed(store: EventStore, opts: HouseholdSeedOpts): SeedEntry[] {
  const ctx: Ctx = {
    ...opts,
    relation: (id) => (id === opts.motherId ? 'mother' : id === opts.fatherId ? 'father' : null),
  }
  const out: SeedEntry[] = []
  for (const ev of store.readFrom(0)) {
    if (ev.tick > opts.upToTick) break
    const said = phrase(ev, ctx)
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
