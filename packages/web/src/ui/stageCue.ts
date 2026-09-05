import { useEffect, useState, useSyncExternalStore } from 'react'
import { agentName, chronicleIcon, type NameIndex, type SceneKind, type SimEvent } from '@sj/shared'
import type { TownScene, WorldStore } from '../state/worldStore.js'
import { chronicleLabel } from './importantFeed.js'

// What the stage says out loud. Everything the town DECIDED used to reach the paper only, which
// is closed by default, so a viewer could not tell that anything had been decided at all.

/** How long a moment stands before the slot goes back to naming the shot. */
export const CUE_HOLD_MS = 6000
/** The glyph is 8×8 drawn at two screen pixels a drawn one, like every pixel mark in the sheet. */
export const CUE_ICON_PX = 16

/** A person appearing who was not born here. `chronicleLine` leaves `agent_spawned` out — the
 *  founding is not news to the town — but a replay of the day somebody walked in is exactly that. */
const ARRIVAL_TYPE = 'agent_spawned'

/** Everything the stage says out loud. A custom is missing on purpose: the arbiter keeps customs
 *  as rows and emits no event for one, so nothing reaches this slot to print (see the report). */
export const CUE_TYPES: readonly string[] = [
  'discovery_made',
  // A death, a birth, a thing finished, somebody arriving, and the four turns of a relationship:
  // what a replay is most often OF. Every one already has a chronicle line, so this costs no copy.
  'agent_died',
  'agent_born',
  'structure_completed',
  'invitation_accepted',
  'invitation_refused',
  'partnership_formed',
  'partnership_dissolved',
  ARRIVAL_TYPE,
  'law_proposed',
  'law_ratified',
  'law_broken',
  'law_repealed',
]

export type StageCue = { text: string; icon: string; bodies: readonly string[] }

/** The payload keys that always name a person. `id` is not one of them — on a finished
 *  structure it names the building. */
const PERSON_KEYS = ['agentId', 'byId', 'aId', 'bId', 'tenderId', 'motherId'] as const
/** ...and the two events where `id` IS the person the moment is about. */
const ID_IS_PERSON: ReadonlySet<string> = new Set(['agent_born', ARRIVAL_TYPE])

/** Whose bodies this moment belongs to — the ones that bounce under it. */
export function bodiesOf(ev: SimEvent): string[] {
  const p = ev.payload as Record<string, unknown>
  const keys = ID_IS_PERSON.has(ev.type) ? ['id', ...PERSON_KEYS] : PERSON_KEYS
  const out: string[] = []
  for (const k of keys) {
    const v = p[k]
    if (typeof v === 'string' && !out.includes(v)) out.push(v)
  }
  return out
}

export function cueFor(ev: SimEvent, state: Parameters<typeof chronicleLabel>[1]): StageCue | null {
  if (!CUE_TYPES.includes(ev.type)) return null
  const bodies = bodiesOf(ev)
  if (ev.type === ARRIVAL_TYPE) {
    const name = (ev.payload as { name?: unknown }).name
    if (typeof name !== 'string' || name === '') return null
    return { text: `${name} came to the town.`, icon: 'star', bodies }
  }
  const text = chronicleLabel(ev, state)
  return text === null ? null : { text, icon: chronicleIcon(ev.type), bodies }
}

// ── THE SCENE IN THE SAME SLOT ─────────────────────────────────────────────────────────────
// A moment is news and is gone in six seconds; a scene is what the town is DOING and stands for
// as long as it runs. Both belong in the one line under the town, so both live here.

/** How long the summary stands after a scene closes, before the slot goes back to the shot. */
export const SCENE_SUMMARY_MS = 8000

/** Open, or standing on its own summary. A scene the slot has finished with is `null` instead. */
export type SceneStage = { scene: TownScene; phase: 'open' | 'summary' }

/** What the slot is holding, given the last frame and the id the hold has already run out on.
 *  A close with nothing to say clears at once — an empty line is not a summary. */
export function sceneStageOf(scene: TownScene | null, clearedId: string | null): SceneStage | null {
  if (scene === null) return null
  if (scene.open) return { scene, phase: 'open' }
  if (scene.id === clearedId) return null
  return scene.summary === undefined || scene.summary.trim() === ''
    ? null
    : { scene, phase: 'summary' }
}

/** The one owner of the eight-second hold: the cue prints off it and the camera lets go on it,
 *  so the shot cannot release while the summary is still on screen. */
export function useSceneStage(store: WorldStore): SceneStage | null {
  const scene = useSyncExternalStore(store.subscribe, store.getScene)
  const [cleared, setCleared] = useState<string | null>(null)
  useEffect(() => {
    if (scene === null || scene.open) return
    const timer = setTimeout(() => {
      setCleared(scene.id)
    }, SCENE_SUMMARY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [scene])
  return sceneStageOf(scene, cleared)
}

/** Three bands, because a viewer reads a band and counts a number. Under four is the town
 *  talking; eight and over is the alarm colour, and it has to be worth it. */
export type StakesBand = 'quiet' | 'warm' | 'hot'
export const STAKES_WARM = 4
export const STAKES_HOT = 8
export const STAKES_MAX = 10

export function stakesBand(stakes: number): StakesBand {
  if (stakes >= STAKES_HOT) return 'hot'
  return stakes >= STAKES_WARM ? 'warm' : 'quiet'
}

/** Who is in it, in the town's own words. Two names read as names and so do three; past that
 *  the line is longer than the thing it is introducing. */
export function sceneNames(participants: readonly string[], agents: NameIndex | undefined): string {
  const names = participants.map((id) => agentName(agents, id))
  if (names.length === 0) return ''
  if (names.length > 3) return `${names[0]!} & ${names.length - 1} others`
  const last = names[names.length - 1]!
  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} & ${last}`
}

export type SceneCue = {
  kind: SceneKind
  /** what is happening and who it is happening between, or the summary once it has closed */
  text: string
  /** 0–10 while it runs. Null once it is over: stakes is a live pressure, not a verdict. */
  stakes: number | null
  band: StakesBand
}

export function sceneCueFor(
  stage: SceneStage | null,
  agents: NameIndex | undefined,
): SceneCue | null {
  if (stage === null) return null
  const { scene } = stage
  if (stage.phase === 'summary') {
    return { kind: scene.kind, text: scene.summary!.trim(), stakes: null, band: 'quiet' }
  }
  const who = sceneNames(scene.participants, agents)
  const topic = scene.topic === null ? '' : scene.topic.trim()
  const text = [topic, who].filter((part) => part !== '').join(' · ')
  return text === ''
    ? null
    : { kind: scene.kind, text, stakes: scene.stakes, band: stakesBand(scene.stakes) }
}

/** One at a time: the slot is one line, and a second moment replaces the first rather than
 *  queueing behind it — a stale moment is worse than a missed one. */
export function useStageCue(store: WorldStore): StageCue | null {
  const [cue, setCue] = useState<StageCue | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = store.onEvents((evts) => {
      const state = store.getState()
      for (const ev of evts) {
        const next = cueFor(ev, state)
        if (next === null) continue
        setCue(next)
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          setCue(null)
        }, CUE_HOLD_MS)
      }
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [store])
  return cue
}
