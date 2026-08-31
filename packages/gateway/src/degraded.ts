/** Two served readers are deliberately forgiving; this makes the forgiveness visible, not silent. */
export type Degradation = { key: string; line: string }

const said = new Map<string, Degradation>()

/** Say `line` on stderr the first time `key` degrades, and never again. */
export function reportOnce(key: string, line: () => string): void {
  if (said.has(key)) return
  const d: Degradation = { key, line: line() }
  said.set(key, d)
  console.warn(`gateway: ${d.line}`)
}

export const degradations = (): Degradation[] => [...said.values()]

/** Testing seam: the map is process-wide, because so is the process's ignorance. */
export const clearDegradations = (): void => {
  said.clear()
}
