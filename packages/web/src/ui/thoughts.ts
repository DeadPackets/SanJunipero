import { pref } from './storage.js'

/** ★ What a viewer wants the wisps to do. A word rather than a flag, because the axis is not
 *  two-valued for long: an "asides only" state that keeps the short remarks and drops the long
 *  deliberations is the next one, and adding it here is the whole of what it costs on disk. */
const SETTINGS = ['shown', 'hidden'] as const
export type ThoughtsSetting = (typeof SETTINGS)[number]

// A word this build does not know is a word a later one wrote: the town is shown whole rather
// than half, which is the safe half of the bargain.
const THOUGHTS = pref('sj.thoughts', SETTINGS, 'shown')
export const thoughtsSetting = THOUGHTS.read
export const rememberThoughts = THOUGHTS.write

/** Two hands on one gate, and neither turns the other back on: the town's own grave tone stops
 *  the wisps, and so does the viewer. Speech is world fact and passes either way. */
export function thoughtsHidden(graveTone: boolean, viewer: ThoughtsSetting): boolean {
  return graveTone || viewer === 'hidden'
}

/** The weight, on the mind's own 1–10 scale, at which a thought is worth a wisp to a stranger. */
export const BUBBLE_IMPORTANCE = 6

/** Whose head the wisps stay with. The viewer's own pick outranks the auto-director, the way a
 *  hand on the lens does; a broadcast nobody clicks on has only the director's subject. */
export function bubbleSubject(scene: {
  pickedId: string | null
  cameraSubject: string | null
}): string | null {
  return scene.pickedId ?? scene.cameraSubject
}

/** ★ Twelve minds thinking every turn is twelve wisps, which is the opposite of easy to follow.
 *  Every thought is still stored and still reaches the Person page; this decides which ones are
 *  drawn over a head: the ones that matter, the one the camera is on, and the room being held. */
export function shouldBubble(
  thought: { agentId: string; importance: number },
  subjectId: string | null,
  sceneMembers: readonly string[],
  timeMoving = true,
): boolean {
  // A scrubbed viewer is standing in a past minute. A thought landing now belongs to the live
  // one, and drawn over the past it is a sentence the minute on screen never held.
  if (!timeMoving) return false
  return (
    thought.importance >= BUBBLE_IMPORTANCE ||
    thought.agentId === subjectId ||
    sceneMembers.includes(thought.agentId)
  )
}
