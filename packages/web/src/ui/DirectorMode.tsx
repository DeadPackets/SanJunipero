import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import type { HeatWindow } from '@sj/shared'
import { CUT_MIN_MS, subjectFor } from './directorCut.js'
import { usePolled } from './useEndpoint.js'

export const HEAT_POLL_MS = 5000
export const DIRECTOR_ZOOM = 3 as const

/** A heat read the gateway refused reads as "no window scored", so the quiet round keeps turning
 *  while it is down. The broadcast path has no operator to notice a caption stuck on one face. */
const NO_HEAT: HeatWindow[] = []

// `autoCut` is the LIVE town being televised; it must not fight a recorded day's playback.
export function DirectorMode({
  store,
  scene,
  autoCut,
  leaving = false,
}: {
  store: WorldStore
  scene: Scene | null
  autoCut: boolean
  leaving?: boolean
}) {
  const [cut, setCut] = useState<string | null>(null)
  // no subject at all while the town is not being televised
  const followed = autoCut ? cut : null
  const followedRef = useRef<string | null>(null)
  const lastCutRef = useRef(0)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  const state = useSyncExternalStore(store.subscribe, store.getState)

  const heat = usePolled<HeatWindow[]>(autoCut ? '/api/heat' : null, undefined, HEAT_POLL_MS)

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
    const now = performance.now()
    if (next !== null && next !== followedRef.current && now - lastCutRef.current >= CUT_MIN_MS) {
      followedRef.current = next
      lastCutRef.current = now
      setCut(next)
    } else if (followedRef.current === null && next !== null) {
      followedRef.current = next
      lastCutRef.current = now
      setCut(next)
    }
  }, [store, autoCut, heat])

  // camera: the scene's follow rig eases toward the followed agent's SPRITE
  // (glide-interpolated), so cuts and tracking are smooth; a drag interrupts it
  useEffect(() => {
    if (scene === null || !autoCut) return
    return () => {
      scene.setFollow(null)
    }
  }, [scene, autoCut])
  // With no subject the picture is the whole settlement: pushing to 3x before the first heat
  // poll has named anybody frames a 3x crop of whatever the camera was over.
  useEffect(() => {
    if (scene === null || !autoCut) return
    if (followed === null) scene.fitToTown()
    else scene.setZoom(DIRECTOR_ZOOM)
  }, [scene, autoCut, followed])
  useEffect(() => {
    if (scene === null) return
    if (leaving || followed === null) {
      scene.setFollow(null)
      return
    }
    scene.setFollow(() => {
      const anchor = scene.anchorOf?.(followed)
      if (anchor !== undefined && anchor !== null) return anchor
      const a = store.getState()?.agents[followed]
      if (a === undefined) return null
      const { sx, sy } = tileToScreen(a.x, a.y)
      return { x: sx, y: sy }
    })
  }, [scene, store, followed, leaving])

  // subtitle: the followed agent's latest speech, else their latest thought
  let subtitle: { text: string; kind: 'speech' | 'thought' } | null = null
  if (followed !== null) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!
      if (ev.type === 'agent_spoke' && (ev.payload as { agentId: string }).agentId === followed) {
        subtitle = { text: (ev.payload as { text: string }).text, kind: 'speech' }
        break
      }
    }
    if (subtitle === null) {
      const t = store.latestThought(followed)
      if (t !== null) subtitle = { text: t.text, kind: 'thought' }
    }
  }
  const name = followed !== null ? (state?.agents[followed]?.name ?? followed) : null

  return (
    <div
      className={leaving ? 'director leaving' : 'director'}
      aria-label="Moments — the town, televised"
    >
      {!leaving && name !== null && (
        <div
          className={subtitle?.kind === 'thought' ? 'subtitle thought' : 'subtitle'}
          role="status"
        >
          <span className="subtitle-name">{name}</span>
          {subtitle !== null ? (
            subtitle.kind === 'thought' ? (
              <em>{subtitle.text}</em>
            ) : (
              `"${subtitle.text}"`
            )
          ) : (
            '…'
          )}
        </div>
      )}
    </div>
  )
}
