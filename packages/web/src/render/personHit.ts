export type PersonTarget = { id: string; x: number; y: number; footY: number }

export function personHit(targets: readonly PersonTarget[], x: number, y: number): string | null {
  let best: { id: string; distance: number } | null = null
  for (const target of targets) {
    const middle = (target.y + target.footY) / 2
    const halfHeight = Math.max(22, (target.footY - target.y) / 2 + 8)
    const dx = (x - target.x) / 22
    const dy = (y - middle) / halfHeight
    const distance = dx * dx + dy * dy
    if (distance > 1) continue
    if (!best || distance < best.distance || (distance === best.distance && target.id < best.id))
      best = { id: target.id, distance }
  }
  return best?.id ?? null
}
