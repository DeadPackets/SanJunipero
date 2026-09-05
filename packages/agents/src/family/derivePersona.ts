import { RngStream } from '@sj/engine'
import type { IdentityCore } from '../prompt/assemble.js'
import type { PersonalityDoc } from '../personality.js'
import { SPAWN_AGE_YEARS } from '@sj/shared'

export type ParentPersona = { agentId: string; identity: IdentityCore; personality: PersonalityDoc }

export const personaOf = (spec: {
  id: string
  identity: IdentityCore
  personality: PersonalityDoc
}): ParentPersona => ({
  agentId: spec.id,
  identity: spec.identity,
  personality: spec.personality,
})

// parents[0] is the mother, parents[1] the father — the order of `agent_born`.
export type Parents = [ParentPersona, ParentPersona]

const PRONOUNS = {
  f: { subject: 'she', object: 'her', possessive: 'her', child: 'daughter' },
  m: { subject: 'he', object: 'him', possessive: 'his', child: 'son' },
} as const

function traitsOf(temperament: string): string[] {
  return temperament
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

// One from her, one from him, one from her — a child is not an average.
function interleave(a: string[], b: string[], limit: number): string[] {
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i += 1) {
    for (const list of [a, b]) {
      const t = list[i]
      if (t !== undefined && !out.includes(t) && out.length < limit) out.push(t)
    }
  }
  return out
}

function sample(rng: RngStream, pool: string[], count: number): string[] {
  const rest = [...new Set(pool)]
  const out: string[] = []
  while (out.length < count && rest.length > 0) out.push(...rest.splice(rng.int(rest.length), 1))
  return out
}

function meanBudget(parents: Parents): { typical: number; burst: number } | undefined {
  const budgets = parents.map((p) => p.identity.voiceCard.wordBudget).filter((b) => b !== undefined)
  if (budgets.length === 0) return undefined
  const mean = (pick: (b: { typical: number; burst: number }) => number): number =>
    Math.round(budgets.reduce((sum, b) => sum + pick(b), 0) / budgets.length)
  return { typical: mean((b) => b.typical), burst: mean((b) => b.burst) }
}

// Early, ordinary, or late. Drawn on a stream of its own so the hours of one person never
// shift the voice of the next.
const HABITS: readonly { rise: number; bed: number }[] = [
  { rise: 6, bed: 21 },
  { rise: 7, bed: 22 },
  { rise: 9, bed: 24 },
]

/** Where a derived person came from: born here, or up the valley road. The two draw on
 *  separate streams, so the same pair of cards never builds the same person twice over. */
export type Origin = 'born' | 'road'

const STREAM: Readonly<Record<Origin, string>> = {
  born: 'child-persona',
  road: 'road-persona',
}

// A derived mind is not authored: it is derived, and derived the same way every
// time, so a replay of the same birth or the same arrival builds the same person.
export function derivePersona(
  child: { id: string; name: string; sex: 'f' | 'm'; ageYears?: number },
  parents: Parents,
  origin: Origin = 'born',
): { identity: IdentityCore; personality: PersonalityDoc } {
  const rng = RngStream.seed(child.id, STREAM[origin])
  const [mother, father] = parents
  const pn = PRONOUNS[child.sex]
  const age = origin === 'road' ? (child.ageYears ?? SPAWN_AGE_YEARS) : SPAWN_AGE_YEARS

  const temperament = interleave(
    traitsOf(mother.identity.temperament),
    traitsOf(father.identity.temperament),
    4,
  ).join(', ')

  const registerFrom = rng.int(2)
  const voices = [mother.identity.voiceCard, father.identity.voiceCard] as const
  const wordBudget = meanBudget(parents)

  const born = [
    `Born in this town to ${mother.identity.name} and ${father.identity.name}, and ${SPAWN_AGE_YEARS} years old from the start, like everyone here.`,
    `${pn.subject[0]!.toUpperCase()}${pn.subject.slice(1)} knows the house ${pn.subject} was born in and the two people in it, and almost nothing else yet.`,
  ].join(' ')
  // No parents to name: a walker's history is a road, and the two cards behind them are only
  // where the voice came from. What lies down the valley is theirs to say and nobody else's.
  const road = [
    `Came up the valley road at ${age}, with what fits in a pack and no plan past finding a roof.`,
    `${pn.subject[0]!.toUpperCase()}${pn.subject.slice(1)} knows the road behind ${pn.object} and nothing of this town yet.`,
  ].join(' ')

  const identity: IdentityCore = {
    name: child.name,
    age,
    backstory: origin === 'road' ? road : born,
    temperament,
    hours: HABITS[RngStream.seed(child.id, 'hours').int(HABITS.length)]!,
    voiceCard: {
      register: voices[registerFrom]!.register,
      rhythm: voices[1 - registerFrom]!.rhythm,
      tics: sample(rng, [...voices[0].tics, ...voices[1].tics], 2),
      neverSays: sample(rng, [...voices[0].neverSays, ...voices[1].neverSays], 2),
      exampleLines: sample(rng, [...voices[0].exampleLines, ...voices[1].exampleLines], 2),
      ...(wordBudget === undefined ? {} : { wordBudget }),
    },
  }

  const personality: PersonalityDoc = {
    temperament,
    values: sample(rng, [...mother.personality.values, ...father.personality.values], 2),
    beliefs: sample(rng, [...mother.personality.beliefs, ...father.personality.beliefs], 2),
    current:
      origin === 'road'
        ? {
            mood: 'tired from the road and looking around',
            worries: ['whether this town has room for one more'],
            goals: ['find out what this place is', 'find out who here would take you in'],
          }
        : {
            mood: 'new to all of it',
            worries: [],
            goals: ['learn what this place is', 'find out what your hands are good for'],
          },
  }

  return { identity, personality }
}
