import { tickToMoment } from '@sj/shared'

/** ONE author for the stamp over a moment. Five pages printed it, four spellings deep. */
export const momentStamp = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}
