import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { CUT_MIN_MS, subjectFor, type HeatWindow } from './directorCut.js'

export const HEAT_POLL_MS = 5000
export const DIRECTOR_ZOOM = 3 as const

// `autoCut` is the LIVE town being televised; it must not fight a recorded day's playback.
export function DirectorMode({ store, scene, autoCut, leaving = false }: {
  store: WorldStore
  scene: Scene | null
  autoCut: boolean
  leaving?: boolean
}) {
  const [followed, setFollowed] = useState<string | null>(null)
  const followedRef = useRef<string | null>(null)
  const lastCutRef = useRef(0)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  // read inside the poll, never subscribed to — the town changing must not restart the timer
  const livingRef = useRef<string[]>([])
  livingRef.current = Object.values(state?.agents ?? {})
    .filter((a) => a.alive).map((a) => a.id).sort()

  // heat poll → sticky cut, never faster than CUT_MIN_MS
  useEffect(() => {
    if (!autoCut) {
      followedRef.current = null
      setFollowed(null)
      return
    }
    let alive = true
    const poll = (): void => {
      void fetch('/api/heat')
        .then(async (r) => (r.ok ? ((await r.json()) as HeatWindow[]) : []))
        .then((heat) => {
          if (!alive) return
          const next = subjectFor(heat, followedRef.current, store.getTick(), livingRef.current)
          const now = performance.now()
          if (next !== null && next !== followedRef.current && now - lastCutRef.current >= CUT_MIN_MS) {
            followedRef.current = next
            lastCutRef.current = now
            setFollowed(next)
          } else if (followedRef.current === null && next !== null) {
            followedRef.current = next
            lastCutRef.current = now
            setFollowed(next)
          }
        })
        .catch(() => {})
    }
    poll()
    const timer = setInterval(poll, HEAT_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [store, autoCut])

  // camera: the scene's follow rig eases toward the followed agent's SPRITE
  // (glide-interpolated), so cuts and tracking are smooth; a drag interrupts it
  useEffect(() => {
    if (scene === null || !autoCut) return
    return () => scene.setFollow(null)
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
  const name = followed !== null ? state?.agents[followed]?.name ?? followed : null

  return (
    <div className={leaving ? 'director leaving' : 'director'} aria-label="Moments — the town, televised">
      {!leaving && name !== null && (
        <div className={subtitle?.kind === 'thought' ? 'subtitle thought' : 'subtitle'} role="status">
          <span className="subtitle-name">{name}</span>
          {subtitle !== null ? (subtitle.kind === 'thought' ? <em>{subtitle.text}</em> : `"${subtitle.text}"`) : '…'}
        </div>
      )}
    </div>
  )
}
