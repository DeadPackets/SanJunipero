import { SOMEONE, type SimEvent, verbPhrase, verbPhrasePast } from '@sj/shared'
import type { DetectConfig, DetectedInstitution, SceneSegment } from './types.js'

export const DEFAULT_DETECT_CONFIG: DetectConfig = {
  groupMinCoScenes: 3,
  groupMinMembers: 2,
  roleMinActions: 3,
  ruleMinAgents: 2,
  ruleMinActions: 4,
}

export const ROLE_VERBS: Record<string, string> = {
  tend: 'caretaker',
  teach: 'teacher',
  build: 'builder',
  craft: 'crafter',
  fish: 'fisher',
  forage: 'forager',
}

type Completed = { seq: number; agentId: string; verb: string }

// `foundingSceneIndex` is an index into the scenes array, -1 when the founding event sits in a
// dropped scene. The caller maps it to a store id and must never persist -1.
export function detectInstitutions(
  scenes: SceneSegment[],
  events: SimEvent[],
  cfg: DetectConfig = DEFAULT_DETECT_CONFIG,
  nameOf: (id: string) => string = () => SOMEONE,
): DetectedInstitution[] {
  const sceneOf = (seq: number): number => scenes.findIndex((s) => s.eventIds.includes(seq))

  const completed: Completed[] = []
  for (const e of events) {
    if (e.type !== 'action_completed') continue
    const p = e.payload as Record<string, unknown>
    if (typeof p.agentId === 'string' && typeof p.verb === 'string') {
      completed.push({ seq: e.seq, agentId: p.agentId, verb: p.verb })
    }
  }

  const out: DetectedInstitution[] = []

  // roles: agent x role-verb, count >= roleMinActions
  const byAgentVerb = new Map<string, number[]>() // "agent|verb" -> seqs
  for (const c of completed) {
    if (!(c.verb in ROLE_VERBS)) continue
    const key = `${c.agentId}|${c.verb}`
    const seqs = byAgentVerb.get(key) ?? []
    seqs.push(c.seq)
    byAgentVerb.set(key, seqs)
  }
  for (const [key, seqs] of byAgentVerb) {
    if (seqs.length < cfg.roleMinActions) continue
    const [agentId, verb] = key.split('|') as [string, string]
    const label = ROLE_VERBS[verb]
    out.push({
      kind: 'role',
      name: `the ${label}`,
      description: `${nameOf(agentId)} has ${verbPhrasePast(verb)} ${seqs.length} times`,
      foundingSceneIndex: sceneOf(seqs[0]!),
      memberIds: [agentId],
      sourceEventIds: seqs,
    })
  }

  // groups: connected components over co-scene edges of count >= groupMinCoScenes
  const coCount = new Map<string, number>() // "a|b" (a<b) -> co-scene count
  for (const s of scenes) {
    const cast = [...new Set(s.cast)].sort()
    for (let i = 0; i < cast.length; i++) {
      for (let j = i + 1; j < cast.length; j++) {
        const key = `${cast[i]}|${cast[j]}`
        coCount.set(key, (coCount.get(key) ?? 0) + 1)
      }
    }
  }
  const adj = new Map<string, Set<string>>()
  for (const [key, n] of coCount) {
    if (n < cfg.groupMinCoScenes) continue
    const [a, b] = key.split('|') as [string, string]
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a)!.add(b)
    adj.get(b)!.add(a)
  }
  const visited = new Set<string>()
  for (const start of [...adj.keys()].sort()) {
    if (visited.has(start)) continue
    const members: string[] = []
    const stack = [start]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (visited.has(node)) continue
      visited.add(node)
      members.push(node)
      for (const next of adj.get(node) ?? []) if (!visited.has(next)) stack.push(next)
    }
    if (members.length < cfg.groupMinMembers) continue
    members.sort()
    const named = members.map(nameOf)
    const memberSet = new Set(members)
    const foundingIdx = scenes.findIndex((s) => s.cast.filter((a) => memberSet.has(a)).length >= 2)
    out.push({
      kind: 'group',
      name: named.join(' & '),
      description: `${named.join(' & ')} are often seen together`,
      foundingSceneIndex: foundingIdx,
      memberIds: members,
      sourceEventIds: foundingIdx === -1 ? [] : scenes[foundingIdx]!.eventIds,
    })
  }

  // rules: a verb (excluding give) done by >= ruleMinAgents agents, >= ruleMinActions times
  const byVerb = new Map<string, { agents: Set<string>; seqs: number[] }>()
  for (const c of completed) {
    if (c.verb === 'give') continue
    const entry = byVerb.get(c.verb) ?? { agents: new Set<string>(), seqs: [] }
    entry.agents.add(c.agentId)
    entry.seqs.push(c.seq)
    byVerb.set(c.verb, entry)
  }
  for (const [verb, { agents, seqs }] of byVerb) {
    if (agents.size < cfg.ruleMinAgents || seqs.length < cfg.ruleMinActions) continue
    out.push({
      kind: 'rule',
      name: `people ${verbPhrase(verb)}`,
      description: `${agents.size} people have ${verbPhrasePast(verb)} ${seqs.length} times`,
      foundingSceneIndex: sceneOf(seqs[0]!),
      memberIds: [...agents].sort(),
      sourceEventIds: seqs,
    })
  }

  return out
}
