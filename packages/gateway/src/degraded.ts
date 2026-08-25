/**
 * ★ A STREAM THAT DEGRADES QUIETLY IS A STREAM NOBODY FIXES.
 *
 * Two readers on the served surface are deliberately forgiving, and both are RIGHT to be: a row
 * a future writer shaped differently must not 500 the observatory, and a town whose narrator has
 * never run must not 500 either. What neither did was say so. A schema drift or an unwritten
 * table was therefore invisible rather than degraded — the body came back well-formed and short,
 * and nothing anywhere counted what had been dropped.
 *
 * ONCE PER PROCESS, AND THAT IS THE WHOLE DESIGN. These readers run behind the seq cache, which
 * rebuilds every generation — four times a second on a live world. A line per occurrence would
 * be a quarter of a million lines a day saying the same sentence, which is a second way of
 * being invisible. The FIRST one is the news; after that the drift is known.
 *
 * `degradations()` exists so a test can assert the report without capturing stderr, and so a
 * health route can list them if one is ever mounted — but the log line is the signal, because
 * a gauge nobody polls is exactly the defect this fixes.
 */
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
export const clearDegradations = (): void => said.clear()
