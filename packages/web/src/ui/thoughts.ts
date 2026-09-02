/** ★ What a viewer wants the wisps to do. A word rather than a flag, because the axis is not
 *  two-valued for long: an "asides only" state that keeps the short remarks and drops the long
 *  deliberations is the next one, and adding it here is the whole of what it costs on disk. */
const SETTINGS = ['shown', 'hidden'] as const
export type ThoughtsSetting = (typeof SETTINGS)[number]

const THOUGHTS = 'sj.thoughts'

export function thoughtsSetting(storage: Pick<Storage, 'getItem'> | null): ThoughtsSetting {
  try {
    const said = storage?.getItem(THOUGHTS)
    // A word this build does not know is a word a later one wrote: the town is shown whole
    // rather than half, which is the safe half of the bargain.
    return SETTINGS.find((s) => s === said) ?? 'shown'
  } catch {
    return 'shown'
  }
}

export function rememberThoughts(
  storage: Pick<Storage, 'setItem'> | null,
  v: ThoughtsSetting,
): void {
  try {
    storage?.setItem(THOUGHTS, v)
  } catch {
    /* nothing to do: the choice holds for this page and is asked again on the next */
  }
}

/** Two hands on one gate, and neither turns the other back on: the town's own grave tone stops
 *  the wisps, and so does the viewer. Speech is world fact and passes either way. */
export function thoughtsHidden(graveTone: boolean, viewer: ThoughtsSetting): boolean {
  return graveTone || viewer === 'hidden'
}
