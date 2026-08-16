import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import { tileToScreen } from '../render/iso.js'
import { CUT_MIN_MS, pickCut, type HeatWindow } from './directorCut.js'

export const HEAT_POLL_MS = 5000
export const CAM_LERP = 0.08
export const DIRECTOR_ZOOM = 3 as const

export function DirectorMode({ store, scene }: { store: WorldStore; scene: Scene | null }) {
  const [followed, setFollowed] = useState<string | null>(null)
  const followedRef = useRef<string | null>(null)
  const lastCutRef = useRef(0)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  const state = useSyncExternalStore(store.subscribe, store.getState)

  // heat poll → sticky cut, never faster than CUT_MIN_MS
  useEffect(() => {
    let alive = true
    const poll = (): void => {
      void fetch('/api/heat')
        .then(async (r) => (r.ok ? ((await r.json()) as HeatWindow[]) : []))
        .then((heat) => {
          if (!alive) return
          const next = pickCut(heat, followedRef.current, store.getTick())
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
  }, [store])

  // camera: ease toward the followed agent at zoom 3 (interruptible rAF, dies with the lens)
  useEffect(() => {
    if (scene === null) return
    scene.setZoom(DIRECTOR_ZOOM)
    let raf = 0
    const step = (): void => {
      const agentId = followedRef.current
      const a = agentId !== null ? store.getState()?.agents[agentId] : undefined
      if (a !== undefined) {
        const { sx, sy } = tileToScreen(a.x, a.y)
        const targetX = scene.app.screen.width / 2 - sx * scene.world.scale.x
        const targetY = scene.app.screen.height / 2 - sy * scene.world.scale.y
        scene.world.position.x += (targetX - scene.world.position.x) * CAM_LERP
        scene.world.position.y += (targetY - scene.world.position.y) * CAM_LERP
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [scene, store])

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
    <div className="director" aria-label="Moments — the town, televised">
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      {name !== null && (
        <div className={subtitle?.kind === 'thought' ? 'subtitle thought' : 'subtitle'} role="status">
          <span className="subtitle-name">{name}</span>
          {subtitle !== null ? (subtitle.kind === 'thought' ? <em>{subtitle.text}</em> : `"${subtitle.text}"`) : '…'}
        </div>
      )}
    </div>
  )
}
