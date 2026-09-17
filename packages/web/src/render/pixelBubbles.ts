import { agentName } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { bubbleLife, type BubbleLayer } from './bubbles.js'
import { thoughtsHidden, type ThoughtsSetting } from '../ui/thoughts.js'
import { screenAnchor } from '../stage/anchor.js'
import { tintOf } from '../paper/game/shared.js'
import icons from '../paper/game/assets/flat-icons.png'

type Line = { agentId: string; text: string; sceneId: string | null; isThought: boolean }

export function createPixelBubbles(scene: Scene, store: WorldStore): BubbleLayer {
  let graveTone = false
  let viewer: ThoughtsSetting = 'shown'
  const root = document.createElement('div')
  root.className = 'pixel-speech-layer'
  root.setAttribute('aria-hidden', 'true')
  scene.app.canvas.parentElement!.append(root)
  const balloon = document.createElement('div')
  balloon.className = 'pixel-balloon'
  const name = document.createElement('strong')
  name.className = 'pixel-speaker'
  const body = document.createElement('p')
  const reserved = document.createElement('span')
  reserved.className = 'pixel-reserved'
  const written = document.createElement('span')
  body.append(reserved, written)
  balloon.append(name, body)
  const ring = document.createElement('div')
  ring.className = 'pixel-speaking-ring'
  const reaction = document.createElement('span')
  reaction.className = 'pixel-reaction sj-icon'
  reaction.style.backgroundImage = `url(${icons})`
  root.append(ring, balloon, reaction)
  root.hidden = true
  let queue: Line[] = [],
    active: Line | null = null,
    born = 0,
    typed = -1
  let lastTick = store.getTick(),
    lastLive = store.getMode().live
  let reactAt = 0,
    reactId: string | null = null,
    reactScene: string | null = null
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const clear = () => {
    queue = []
    active = null
    reactId = null
    root.hidden = true
  }
  const off = store.onEvents((events) => {
    for (const ev of events) {
      if (ev.type !== 'scene_line') continue
      const p = ev.payload as { id: string; agentId: string; move: string }
      const index = p.move === 'agree' ? 0 : p.move === 'joke' || p.move === 'tease' ? 9 : null
      if (index === null) continue
      reactId = p.agentId
      reactScene = p.id
      reactAt = performance.now()
      reaction.style.backgroundPosition = `${((index % 4) * 100) / 3}% ${(Math.floor(index / 4) * 100) / 3}%`
    }
  })
  const anchor = (id: string) => {
    const a = store.getState()?.agents[id]
    if (!a?.alive) return null
    if (scene.interior?.isActive()) {
      if (a.insideId !== scene.interior.activeId()) return null
      return scene.interior.speechAnchor?.(id) ?? null
    }
    if (a.insideId != null) return null
    const at = scene.pointOf('agent', id)
    if (!at) return null
    const foot = screenAnchor(scene.viewRect(), scene.getZoom(), at.sx, at.sy)
    return foot.onScreen ? { x: foot.x, y: foot.y - 40 * scene.getZoom(), footY: foot.y } : null
  }
  const gateThoughts = () => {
    if (!thoughtsHidden(graveTone, viewer)) return
    queue = queue.filter((line) => !line.isThought)
    if (active?.isThought) {
      active = null
      root.hidden = true
    }
  }
  const spawn = (agentId: string, text: string, isThought: boolean) => {
    if (!store.timeMoving() || !text.trim() || !anchor(agentId)) return
    if (isThought && (thoughtsHidden(graveTone, viewer) || (active && !active.isThought))) return
    const room = store.openScenes().find((s) => s.participants.includes(agentId))
    const shot = store.shotScene()
    if (shot?.open && room && shot.id !== room.id) return
    if (isThought) {
      if (queue.some((line) => !line.isThought)) return
      queue = queue.filter((line) => line.agentId !== agentId)
      if (active?.isThought && active.agentId === agentId) active = null
    } else {
      queue = queue.filter((line) => !line.isThought)
      if (active?.isThought) active = null
    }
    queue.push({ agentId, text, sceneId: room?.id ?? null, isThought })
    if (queue.length > 12) queue.shift()
  }
  return {
    spawnSpeech: (agentId, text) => spawn(agentId, text, false),
    spawnThought: (agentId, text) => spawn(agentId, text, true),
    setSuppressed(value) {
      graveTone = value
      gateThoughts()
    },
    setThoughts(value) {
      viewer = value
      gateThoughts()
    },
    tick(now) {
      const tick = store.getTick(),
        live = store.getMode().live
      if (tick < lastTick || live !== lastLive || !store.timeMoving()) clear()
      lastTick = tick
      lastLive = live
      if (document.hidden) {
        clear()
        return
      }
      const shot = store.shotScene()
      if (
        active &&
        (now - born > bubbleLife(active.text, active.isThought) ||
          !anchor(active.agentId) ||
          (shot?.open && active.sceneId !== null && active.sceneId !== shot.id))
      )
        active = null
      queue = queue.filter(
        (line) => !shot?.open || line.sceneId === null || line.sceneId === shot.id,
      )
      if (!active && queue.length) {
        active = queue.shift()!
        born = now
        typed = -1
        const speaker = agentName(store.getState()?.agents, active.agentId)
        name.textContent = active.isThought ? `${speaker} · Thought` : speaker
        balloon.dataset.kind = active.isThought ? 'thought' : 'speech'
        ring.hidden = active.isThought
        reserved.textContent = active.text
        balloon.dataset.tint = tintOf(active.agentId)
        ring.dataset.tint = tintOf(active.agentId)
        balloon.getAnimations().forEach((animation) => animation.cancel())
        if (!reduced.matches)
          balloon.animate(
            [
              { opacity: 0, scale: '.96', translate: '0 5px' },
              { opacity: 1, scale: '1', translate: '0 0' },
            ],
            { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
          )
      }
      const at = active ? anchor(active.agentId) : null
      root.hidden = !at
      if (!active || !at) return
      balloon.hidden = scene.getZoom() <= 0.5 && !scene.interior?.isActive()
      const w = balloon.offsetWidth,
        h = balloon.offsetHeight
      const width = scene.app.screen.width
      const x = Math.max(12, Math.min(width - w - 12, at.x - w / 2))
      const top = (scene.safeInsets?.top ?? 0) + 24
      let y = Math.max(top, at.y - h - 20)
      const below = y + h > at.y - 6
      if (below) y = at.footY + 22
      balloon.dataset.below = String(below)
      balloon.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
      balloon.style.setProperty('--tail-x', `${Math.max(16, Math.min(w - 16, at.x - x))}px`)
      const n =
        reduced.matches || active.isThought
          ? active.text.length
          : Math.min(active.text.length, Math.floor((now - born) / 30))
      if (n !== typed) {
        written.textContent = active.text.slice(0, n)
        typed = n
      }
      ring.style.transform = `translate(${at.x}px,${at.footY}px)`
      const r =
        !active.isThought && reactId && reactScene === active.sceneId && now - reactAt < 2300
          ? anchor(reactId)
          : null
      reaction.hidden = !r
      if (r) reaction.style.transform = `translate(${r.x - 16}px,${r.y - 42}px)`
    },
    destroy() {
      off()
      root.remove()
    },
  }
}
