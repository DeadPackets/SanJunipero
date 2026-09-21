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

export function personHoverPosition(
  at: { x: number; y: number },
  viewport: { width: number; height: number },
  label: { width: number; height: number },
  safe: { top: number; right?: number; bottom: number },
): { x: number; y: number } | null {
  const left = label.width / 2 + 8
  const right = viewport.width - (safe.right ?? 0) - left
  const top = safe.top + 8
  const bottom = viewport.height - safe.bottom - label.height - 8
  if (right < left || bottom < top) return null
  return {
    x: Math.max(left, Math.min(right, at.x)),
    y: Math.max(top, Math.min(bottom, at.y - 36)),
  }
}
