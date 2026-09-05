import { z } from 'zod'

// The three acts that need a second consent, and the one that needs none. Held here because
// engine, agents, gateway and viewer all read the same list, and a second copy is one that drifts.
export const INVITATION_VERBS = ['court', 'propose', 'lie_with'] as const
export type InvitationVerb = (typeof INVITATION_VERBS)[number]
export const InvitationVerbSchema = z.enum(INVITATION_VERBS)

export const RELATIONSHIP_VERBS = [...INVITATION_VERBS, 'leave_partner'] as const

/** How long an unanswered ask still counts as an ask when the same verb comes back. */
export const INVITATION_STANDS_TICKS = 180

export const RELATIONSHIP_EVENT_TYPES = [
  'invited',
  'invitation_accepted',
  'invitation_refused',
  'partnership_formed',
  'partnership_dissolved',
] as const

// Who is in the valley at all. Not a relationship, but read through the same tail: a coming and
// a going both change who the people in a talk can be talking to.
export const PRESENCE_EVENT_TYPES = ['agent_arrived', 'agent_departed'] as const
