import type { Structure } from '@sj/engine/state'

const BODY_RADIUS = 0.7

export function clearBody(
  x: number,
  y: number,
  structures: readonly Structure[],
): { x: number; y: number } {
  for (let pass = 0; pass < 3; pass++) {
    for (const s of structures) {
      if (s.kind === 'bridge') continue
      const inset = Math.min(0.22, Math.min(s.w, s.h) * 0.2)
      const left = s.x + inset - BODY_RADIUS,
        right = s.x + s.w - inset + BODY_RADIUS
      const back = s.y + inset - BODY_RADIUS,
        front = s.y + s.h - inset + BODY_RADIUS
      if (x <= left || x >= right || y <= back || y >= front) continue
      const distance = [x - left, right - x, y - back, front - y]
      const side = distance.indexOf(Math.min(...distance))
      if (side === 0) x = left
      else if (side === 1) x = right
      else if (side === 2) y = back
      else y = front
    }
  }
  return { x, y }
}
