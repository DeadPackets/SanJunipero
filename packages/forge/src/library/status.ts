import type { VisionVerdict } from '../visionQa/verdict.js'

// R-20: the runner's own status said `blocked` whenever the ITEM did not close, which counts a
// clean sprite whose icon failed its three rounds. The sprite gate's outcome is its last verdict.
export function spriteGateStatus<F extends string>(
  spriteVerdicts: readonly VisionVerdict[], fallback: F,
): 'pass' | 'blocked' | F {
  const last = spriteVerdicts.at(-1)
  if (last === undefined) return fallback
  return last.overall === 'pass' ? 'pass' : 'blocked'
}
