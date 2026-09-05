// What the five relationship events mean to the people in them: the sentence the invitee reads,
// the ties each one leaves, and the lines that go in a book. Pure, and the only place any of it
// is written — a leaving from an ordinary turn and a restart mid-ask land the same ties.
import type { InvitationVerb } from '@sj/shared'
import {
  AgentArrived,
  AgentBorn,
  AgentDeparted,
  InvitationAccepted,
  InvitationRefused,
  Invited,
  PartnershipDissolved,
  PartnershipFormed,
} from '@sj/engine'
import type { TieDelta } from './scene.js'

/** An invitation is worth more than a good morning and less than a fire. */
export const INVITATION_STAKES = 8

export type RelationshipFact =
  | { type: 'invited'; agentId: string; byId: string; verb: InvitationVerb }
  | { type: 'invitation_accepted'; agentId: string; byId: string; verb: InvitationVerb }
  | {
      type: 'invitation_refused'
      agentId: string
      byId: string
      verb: InvitationVerb
      witnesses: readonly string[]
    }
  | { type: 'partnership_formed'; aId: string; bId: string }
  | { type: 'partnership_dissolved'; aId: string; bId: string; byId: string }
  | { type: 'agent_born'; motherId: string; fatherId: string }
  // Not a relationship: who is in the valley at all. A coming and a going both change who the
  // people in a talk can be talking to, and both come through the same tail.
  | { type: 'agent_arrived'; agentId: string; name: string }
  | { type: 'agent_departed'; agentId: string }

/** The log's own row, read through the engine's own schemas so nothing here can drift off them. */
export function readFact(ev: { type: string; payload: unknown }): RelationshipFact | null {
  switch (ev.type) {
    case 'invited': {
      const p = Invited.safeParse(ev.payload)
      return p.success ? { type: 'invited', ...p.data } : null
    }
    case 'invitation_accepted': {
      const p = InvitationAccepted.safeParse(ev.payload)
      return p.success ? { type: 'invitation_accepted', ...p.data } : null
    }
    case 'invitation_refused': {
      const p = InvitationRefused.safeParse(ev.payload)
      return p.success ? { type: 'invitation_refused', ...p.data } : null
    }
    case 'partnership_formed': {
      const p = PartnershipFormed.safeParse(ev.payload)
      return p.success ? { type: 'partnership_formed', ...p.data } : null
    }
    case 'partnership_dissolved': {
      const p = PartnershipDissolved.safeParse(ev.payload)
      return p.success ? { type: 'partnership_dissolved', ...p.data } : null
    }
    case 'agent_born': {
      const p = AgentBorn.safeParse(ev.payload)
      return p.success
        ? { type: 'agent_born', motherId: p.data.motherId, fatherId: p.data.fatherId }
        : null
    }
    case 'agent_arrived': {
      const p = AgentArrived.safeParse(ev.payload)
      return p.success ? { type: 'agent_arrived', agentId: p.data.id, name: p.data.name } : null
    }
    case 'agent_departed': {
      const p = AgentDeparted.safeParse(ev.payload)
      return p.success ? { type: 'agent_departed', agentId: p.data.agentId } : null
    }
    default:
      return null
  }
}

/** Everybody a fact is about, so one list of deltas can be handed to each of their books. */
export function peopleIn(fact: RelationshipFact): string[] {
  switch (fact.type) {
    case 'partnership_formed':
      return [fact.aId, fact.bId]
    case 'partnership_dissolved':
      return [fact.aId, fact.bId]
    case 'agent_born':
      return [fact.motherId, fact.fatherId]
    case 'agent_arrived':
    case 'agent_departed':
      return [fact.agentId]
    default:
      return [fact.agentId, fact.byId]
  }
}

const ASKED_FOR: Record<InvitationVerb, string> = {
  court: 'to walk out together',
  propose: 'to be partners for good',
  lie_with: 'to lie together, here under this roof',
}

/** What the invitee is told, in the words of the thing itself. */
export function askPhrase(verb: InvitationVerb, askerName: string): string {
  return `${askerName} has asked you ${ASKED_FOR[verb]}. Answer it, accept or refuse, and say what you say.`
}

export const noAnswerLine = (name: string): string => `${name} gave you no answer.`

/** What everybody who knew them carries away from a leaving. Said the way the town would say
 *  it: a direction and a road, because that is the whole of what anybody here saw. */
export const wentDownTheRoadLine = (name: string): string =>
  `${name} has gone down the valley road.`

/** How deeply a leaving lands: on somebody it belonged to, and on everybody else. */
export const DEPARTED_IMPORTANCE = { kin: 9, other: 6 } as const

export const momentPassedLine = (reason: string): string => `The moment passed: ${reason}.`

const pair = (a: string, b: string, kind: TieDelta['kind'], text: string): TieDelta[] => [
  { agentId: a, personId: b, kind, text },
  { agentId: b, personId: a, kind, text },
]

/** What a fact leaves standing between two people. `partnered` says whether the two already
 *  belong to each other, and `roof` names the place a bedding happened under. */
export function tiesFor(
  fact: RelationshipFact,
  ctx: { partnered?: boolean; roof?: string | null } = {},
): TieDelta[] {
  if (fact.type === 'invitation_accepted') {
    if (fact.verb === 'court')
      return pair(fact.agentId, fact.byId, 'attraction', 'you walked out together')
    if (fact.verb === 'propose') return pair(fact.agentId, fact.byId, 'kin', 'your partner')
    if (ctx.partnered === true) return []
    const where = ctx.roof === null || ctx.roof === undefined ? 'one roof' : `the ${ctx.roof}`
    return pair(fact.agentId, fact.byId, 'secret', `what passed between you under ${where}`)
  }
  if (fact.type === 'invitation_refused') {
    if (fact.witnesses.length === 0) return []
    return [
      {
        agentId: fact.byId,
        personId: fact.agentId,
        kind: 'slight',
        text: 'refused you before others',
      },
    ]
  }
  if (fact.type === 'partnership_dissolved') {
    const left = fact.byId === fact.aId ? fact.bId : fact.aId
    return [
      { agentId: fact.aId, personId: fact.bId, kind: 'kin', text: 'your partner', settled: true },
      { agentId: fact.bId, personId: fact.aId, kind: 'kin', text: 'your partner', settled: true },
      { agentId: left, personId: fact.byId, kind: 'grudge', text: 'left you' },
    ]
  }
  return []
}

export type MemoryLine = { agentId: string; text: string; importance: number }

/** What each of them will carry away from it. The asker's ask, the refusal they were handed,
 *  the day they became partners, and the day one of them walked. */
export function memoryLinesFor(
  fact: RelationshipFact,
  nameOf: (id: string) => string,
): MemoryLine[] {
  switch (fact.type) {
    case 'invited':
      return [
        {
          agentId: fact.byId,
          text: `You asked ${nameOf(fact.agentId)} ${ASKED_FOR[fact.verb]}.`,
          importance: 7,
        },
      ]
    case 'invitation_refused':
      return [
        { agentId: fact.byId, text: `${nameOf(fact.agentId)} would not have you.`, importance: 7 },
      ]
    case 'partnership_formed':
      return [fact.aId, fact.bId].map((id) => ({
        agentId: id,
        text: `You and ${nameOf(id === fact.aId ? fact.bId : fact.aId)} are partners now.`,
        importance: 9,
      }))
    case 'partnership_dissolved': {
      const left = fact.byId === fact.aId ? fact.bId : fact.aId
      return [
        { agentId: fact.byId, text: `You left ${nameOf(left)}.`, importance: 9 },
        { agentId: left, text: `${nameOf(fact.byId)} has left you.`, importance: 9 },
      ]
    }
    default:
      return []
  }
}
