export type HeatWindow = { fromTick: number; toTick: number; agentId: string; score: number }

export const CUT_MIN_MS = 8000 // never cut faster — letterboxed TV pacing
export const RECENT_TICKS = 120
export const STICKY_FACTOR = 1.25

// hottest window overlapping [nowTick−120, nowTick]; sticky toward the current agent
export function pickCut(heat: HeatWindow[], currentAgent: string | null, nowTick: number): string | null {
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

/**
 * ★ A BROADCAST ALWAYS HAS A SUBJECT.
 *
 * `pickCut` answers null when nothing has scored, and for a lens a person is steering that is
 * right — the camera stays where they left it. For an unattended stream it is an empty frame,
 * which is the first thing R1 forbids, and the quiet case is not rare: the dev town ran 592
 * ticks with no word spoken, no death and no fire, and its eleven completed structures were
 * all raised by `script`, so `/api/heat` was `[]` the whole time. The broadcast frame opened
 * on a 3× crop of grass with no caption on it, and stayed there.
 *
 * A town with nothing happening still has people in it. The round below turns over one heat
 * window at a time, so a quiet town reads as a slow pass around its inhabitants rather than as
 * a frozen field — and the caption always has a name in it, which is R3's whole question.
 */
export function quietSubject(people: readonly string[], nowTick: number): string | null {
  if (people.length === 0) return null
  const tick = Number.isFinite(nowTick) ? Math.max(0, nowTick) : 0
  return people[Math.floor(tick / QUIET_TURN_TICKS) % people.length]!
}

/** Who the camera is on: the hottest agent, or — when the town is quiet — one of its people. */
export function subjectFor(
  heat: HeatWindow[], currentAgent: string | null, nowTick: number, people: readonly string[],
): string | null {
  return pickCut(heat, currentAgent, nowTick) ?? quietSubject(people, nowTick)
}
