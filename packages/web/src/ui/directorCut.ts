import type { HeatWindow } from '@sj/shared'

export const CUT_MIN_MS = 8000 // never cut faster — letterboxed TV pacing
const RECENT_TICKS = 120
export const STICKY_FACTOR = 1.25

// hottest window overlapping [nowTick−120, nowTick]; sticky toward the current agent
export function pickCut(
  heat: HeatWindow[],
  currentAgent: string | null,
  nowTick: number,
): string | null {
  const recent = heat.filter((w) => w.toTick >= nowTick - RECENT_TICKS && w.fromTick <= nowTick)
  if (recent.length === 0) return null

  const best = new Map<string, number>() // agentId → best recent score
  for (const w of recent) best.set(w.agentId, Math.max(best.get(w.agentId) ?? 0, w.score))

  let hottest: string | null = null
  let hottestScore = -1
  for (const [agentId, score] of [...best.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (score > hottestScore) {
      hottest = agentId
      hottestScore = score
    }
  }

  const currentScore = currentAgent !== null ? best.get(currentAgent) : undefined
  if (currentAgent !== null && currentScore !== undefined && hottest !== currentAgent) {
    return hottestScore >= currentScore * STICKY_FACTOR ? hottest : currentAgent
  }
  return hottest
}

/** One turn of the quiet round, matching the gateway's own 60-tick heat window so a cut and a
 *  turn are the same length of town time. `CUT_MIN_MS` still gates how fast either can land. */
export const QUIET_TURN_TICKS = 60

/** `pickCut` answers null when nothing has scored — right for a lens a person is steering, an
 *  empty frame for an unattended stream. The round turns over one heat window at a time, so the
 *  caption always has a name in it. */
export function quietSubject(people: readonly string[], nowTick: number): string | null {
  if (people.length === 0) return null
  const tick = Number.isFinite(nowTick) ? Math.max(0, nowTick) : 0
  return people[Math.floor(tick / QUIET_TURN_TICKS) % people.length]!
}

/** Who the camera is on: the hottest agent, or — when the town is quiet — one of its people.
 *  Heat is scored for whatever acted, the scripted runner included; only a body can be followed. */
export function subjectFor(
  heat: HeatWindow[],
  currentAgent: string | null,
  nowTick: number,
  people: readonly string[],
): string | null {
  const embodied = heat.filter((w) => people.includes(w.agentId))
  return pickCut(embodied, currentAgent, nowTick) ?? quietSubject(people, nowTick)
}
