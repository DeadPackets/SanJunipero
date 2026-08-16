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
