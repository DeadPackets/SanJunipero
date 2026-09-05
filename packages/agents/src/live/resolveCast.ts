import { AgentArrived, AgentBorn, RngStream } from '@sj/engine'
import type { EventStore } from '@sj/engine/store'
import { DAYS_PER_YEAR, MINUTES_PER_DAY, SPAWN_AGE_YEARS } from '@sj/shared'
import type { z } from 'zod'
import { derivePersona, personaOf, type ParentPersona } from '../family/derivePersona.js'
import type { AgentBornPayload } from '../family/watchBirths.js'
import { FOUNDER_MINDS } from './founderMinds.js'
import type { MindSpec } from './liveMinds.js'
import { TRAVELLER_MINDS } from './travellerMinds.js'

export type AgentArrivedPayload = z.infer<typeof AgentArrived>

/** The person a birth makes. Deterministic, so a resume rebuilds the same child. */
export function childSpec(
  born: AgentBornPayload,
  mother: ParentPersona,
  father: ParentPersona,
  bornDay: number,
): MindSpec {
  const { identity, personality } = derivePersona(born, [mother, father])
  return {
    id: born.id,
    identity,
    personality,
    ageDays: SPAWN_AGE_YEARS * DAYS_PER_YEAR,
    sex: born.sex,
    bornDay,
  }
}

// The sixteen authored voices a walker's own is drawn from. Not a parentage — nobody on this
// list has ever met them — only where a voice with nobody to inherit from comes by one.
const ROAD_CARDS: readonly MindSpec[] = [...FOUNDER_MINDS, ...TRAVELLER_MINDS]

/** Two of the authored cards, drawn off the walker's own id so the same walker is always the
 *  same person. Never the same card twice. */
function cardsFor(id: string): [ParentPersona, ParentPersona] {
  const rng = RngStream.seed(id, 'road-parents')
  const rest = [...ROAD_CARDS]
  const first = rest.splice(rng.int(rest.length), 1)[0]!
  const second = rest.splice(rng.int(rest.length), 1)[0]!
  return [personaOf(first), personaOf(second)]
}

/** The person an unauthored arrival makes: a voice derived off two of the town's own, and a
 *  road behind them nobody here has walked. Deterministic from the id alone. */
export function strangerSpec(arrived: AgentArrivedPayload): MindSpec {
  const { identity, personality } = derivePersona(
    {
      id: arrived.id,
      name: arrived.name,
      sex: arrived.sex,
      ageYears: Math.floor(arrived.ageDays / DAYS_PER_YEAR),
    },
    cardsFor(arrived.id),
    'road',
  )
  return {
    id: arrived.id,
    identity,
    personality,
    ageDays: arrived.ageDays,
    sex: arrived.sex,
  }
}

/** The person an arrival makes: one of the four authored travellers when the road brought one,
 *  and otherwise a walker derived from the id. The one place either is built. */
export function arrivalSpec(arrived: AgentArrivedPayload, arrivedDay: number): MindSpec {
  const traveller = TRAVELLER_MINDS.find((t) => t.id === arrived.id)
  if (traveller !== undefined) {
    const { arrival: _line, ...mind } = traveller
    return { ...mind, arrivedDay }
  }
  return { ...strangerSpec(arrived), arrivedDay }
}

/** The town's people at boot: the founders, plus everyone the log has since born or brought up
 *  the road, replayed in seq order so a child of a child derives from a cast that already has
 *  its parents. The ceiling counts who was still here at that moment — the same count
 *  `wireBirths` and `wireArrivals` admit a live one by, so a resume gives a mind to exactly the
 *  people the town gave one to. A body that died and one that walked out both free a slot. */
export function resolveCast(
  founders: readonly MindSpec[],
  store: EventStore,
  maxMinds: number,
): MindSpec[] {
  const cast = new Map(founders.map((m) => [m.id, m]))
  const bySeq = (a: { seq: number }, b: { seq: number }): number => a.seq - b.seq
  const leavings = [
    ...store.readTypeFrom(0, 'agent_died'),
    ...store.readTypeFrom(0, 'agent_departed'),
  ].sort(bySeq)
  const comings = [
    ...store.readTypeFrom(0, 'agent_born'),
    ...store.readTypeFrom(0, 'agent_arrived'),
  ].sort(bySeq)
  const gone = new Set<string>()
  let past = 0
  for (const ev of comings) {
    while (past < leavings.length && leavings[past]!.seq < ev.seq) {
      gone.add(String((leavings[past]!.payload as { agentId?: unknown }).agentId))
      past += 1
    }
    if ([...cast.keys()].filter((id) => !gone.has(id)).length >= maxMinds) continue
    if (ev.type === 'agent_arrived') {
      const arrived = AgentArrived.parse(ev.payload)
      cast.set(arrived.id, arrivalSpec(arrived, Math.floor(ev.tick / MINUTES_PER_DAY)))
      continue
    }
    const born = AgentBorn.parse(ev.payload)
    const mother = cast.get(born.motherId)
    const father = cast.get(born.fatherId)
    if (mother === undefined || father === undefined) continue
    cast.set(
      born.id,
      childSpec(born, personaOf(mother), personaOf(father), Math.floor(ev.tick / MINUTES_PER_DAY)),
    )
  }
  return [...cast.values()]
}
