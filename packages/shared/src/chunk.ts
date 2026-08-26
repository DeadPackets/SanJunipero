// The ground contract: the world is baked, cached and invalidated in
// 32-tile squares, so a paved tile redraws its own chunk and not a 128x128 map.

export const CHUNK_TILES = 32

export function chunkOf(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_TILES), cy: Math.floor(y / CHUNK_TILES) }
}

// Sorted by (cx, cy) numerically rather than by string, so the order holds past chunk 9.
export function chunksTouched(coords: readonly { x: number; y: number }[]): string[] {
  const seen = new Map<string, { cx: number; cy: number }>()
  for (const { x, y } of coords) {
    const c = chunkOf(x, y)
    seen.set(`${c.cx},${c.cy}`, c)
  }
  return [...seen.entries()].sort(([, a], [, b]) => a.cx - b.cx || a.cy - b.cy).map(([k]) => k)
}
