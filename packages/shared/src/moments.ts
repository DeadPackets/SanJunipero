import { z } from 'zod'
import { SceneKind } from './protocol.js'

// ONE SCENE, not one narrator segment. `/api/moments` used to serve the narrator's segments,
// dozens a day and every one of them titled with the day's chapter title — thirty cards sharing
// one name cannot look significant however they are drawn. A scene has its own topic, its own
// stakes and its own room, so the card has something to be about.
export const MomentSchema = z
  .object({
    /** the log seq of the scene's own opening, so a /moment/<id> link outlives any renumbering */
    id: z.number().int().positive(),
    day: z.number().int().nonnegative(),
    startTick: z.number().int().nonnegative(),
    endTick: z.number().int().nonnegative(),
    title: z.string().min(1),
    cast: z.array(z.string().min(1)),
    location: z.string().nullable(),
    kind: SceneKind,
    /** 0–10 as the coordinator scored it. What the day is ordered by. */
    stakes: z.number().int().min(0).max(10),
    /** what the room came to, once it closed; absent while it is still open */
    summary: z.string().nullable(),
  })
  .strict()
export type Moment = z.infer<typeof MomentSchema>

export const MomentsResponseSchema = z.object({ moments: z.array(MomentSchema) }).strict()

/** What the town calls a room with no topic yet. Never "Scene 12" and never the day's chapter
 *  title, which every scene of that day would have shared. */
const KIND_TITLE: Readonly<Record<SceneKind, string>> = {
  talk: 'They talked',
  quarrel: 'They fell out',
  council: 'The town sat down together',
  gathering: 'They gathered',
  telling: 'Somebody told it',
  invitation: 'An invitation',
}

export function momentTitle(kind: SceneKind, topic: string | null): string {
  const t = topic?.trim() ?? ''
  return t === '' ? KIND_TITLE[kind] : t
}

/** Newest day first, and inside a day the scene with most at stake leads. A tie is broken by the
 *  earlier scene, so the order never depends on how the rows came back. */
export function byDayThenStakes(a: Moment, b: Moment): number {
  return b.day - a.day || b.stakes - a.stakes || a.startTick - b.startTick
}
