import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import type { HeatWindow } from '@sj/shared'
import { CUT_MIN_MS, subjectFor } from './directorCut.js'
import { usePolled } from './useEndpoint.js'

export const HEAT_POLL_MS = 5000
export const DIRECTOR_ZOOM = 3 as const
/** The first viewport, and the one between cuts: the town, close enough to read. */
export const OVERVIEW_ZOOM = 1 as const

/** A heat read the gateway refused reads as "no window scored", so the quiet round keeps turning
 *  while it is down. The broadcast path has no operator to notice a caption stuck on one face. */
const NO_HEAT: HeatWindow[] = []

/** `autoCut` is the live town being televised; `pinned` is a viewer who asked to follow one
 *  person, which outranks the heat. It draws nothing — `DirectorCue` prints the word. */
export function DirectorMode({
  store,
  scene,
  autoCut,
  pinned = null,
  onCue,
}: {
  store: WorldStore
  scene: Scene | null
  autoCut: boolean
  pinned?: string | null
  onCue?: (text: string | null) => void
}) {
  const [cut, setCut] = useState<string | null>(null)
  const followed = pinned ?? (autoCut ? cut : null)
  const followedRef = useRef<string | null>(null)
  const lastCutRef = useRef(0)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  // The overview is OF a town, so it has to wait for one: an empty world has no centre but
  // whatever corner of the ground the camera was created over.
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)

  const heat = usePolled<HeatWindow[]>(
    autoCut && pinned === null ? '/api/heat' : null,
    undefined,
    HEAT_POLL_MS,
  )

  // heat read → sticky cut, one turn per read that settles, never faster than CUT_MIN_MS
  useEffect(() => {
    if (!autoCut) {
      followedRef.current = null
      return
    }
    if (!heat.loaded) return
    // read here, never subscribed to — the town changing must not turn the round
    const living = Object.values(store.getState()?.agents ?? {})
      .filter((a) => a.alive)
      .map((a) => a.id)
      .sort()
    const next = subjectFor(heat.data ?? NO_HEAT, followedRef.current, store.getTick(), living)
    // The first subject arrives at once; every later cut waits out CUT_MIN_MS.
    const now = performance.now()
    const first = followedRef.current === null
    if (
      next !== null &&
      next !== followedRef.current &&
      (first || now - lastCutRef.current >= CUT_MIN_MS)
    ) {
      followedRef.current = next
      lastCutRef.current = now
      setCut(next)
    }
  }, [store, autoCut, heat])

  // With no subject the picture is the town itself. Centre BEFORE the stop changes: the zoom
  // eases about whatever the middle of the screen holds.
  useEffect(() => {
    if (scene === null) return
    if (followed === null) {
      scene.setFollow(null)
      if (awake) {
        scene.centerHome()
        scene.setZoom(OVERVIEW_ZOOM)
      }
      return
    }
    scene.setZoom(DIRECTOR_ZOOM)
    scene.setFollow(() => {
      const anchor = scene.anchorOf?.(followed)
      if (anchor !== undefined && anchor !== null) return anchor
      const a = store.getState()?.agents[followed]
      if (a === undefined) return null
      const { sx, sy } = tileToScreen(a.x, a.y)
      return { x: sx, y: sy }
    })
    return () => {
      scene.setFollow(null)
    }
  }, [scene, store, followed, awake])

  const name = followed === null ? null : (state?.agents[followed]?.name ?? followed)
  useEffect(() => {
    onCue?.(name === null ? null : `${pinned === null ? 'DIRECTOR' : 'FOLLOWING'} · ${name}`)
  }, [name, pinned, onCue])

  return null
}
