import { agentName } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { bubbleLife, type BubbleLayer } from './bubbles.js'
import { thoughtsHidden, type ThoughtsSetting } from '../ui/thoughts.js'
import { agentScreenAnchor } from './agentAnchor.js'
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
  let lastView = store.viewSeq()
  let lastRoom = scene.interior?.activeId() ?? null
  let clock = 0,
    previousTime: number | null = null
  let reactAt = 0,
    reactId: string | null = null,
    reactScene: string | null = null
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  let dimensions = { w: 0, h: 0 }
  let measureNeeded = true
  const resized = new ResizeObserver(() => {
    measureNeeded = true
  })
  resized.observe(scene.app.canvas)
  const fontsReady = () => {
    measureNeeded = true
  }
  document.fonts.addEventListener('loadingdone', fontsReady)
  const measure = () => {
    balloon.getAnimations().forEach((animation) => {
      animation.cancel()
    })
    balloon.style.width = ''
    const range = document.createRange()
    range.selectNodeContents(reserved)
    const lines = [...range.getClientRects()].map((rect) => rect.width)
    if (lines.length) {
      const textWidth = Math.max(...lines)
      const nameWidth = name.getBoundingClientRect().width + 24
      balloon.style.width = `${Math.ceil(Math.max(textWidth + 22, nameWidth))}px`
    }
    dimensions = { w: balloon.offsetWidth, h: balloon.offsetHeight }
    measureNeeded = false
  }
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
      reactAt = clock
      reaction.style.backgroundPosition = `${((index % 4) * 100) / 3}% ${(Math.floor(index / 4) * 100) / 3}%`
    }
  })
  const anchor = (id: string) => agentScreenAnchor(scene, store, id)
  const focus = () => {
    const shot = store.shotScene()
    if (!scene.interior?.isActive()) return shot
    if (shot?.open && shot.participants.some((id) => anchor(id))) return shot
    const rooms = store.openScenes().filter((room) => room.participants.some((id) => anchor(id)))
    return rooms.find((room) => room.id === active?.sceneId) ?? rooms[0] ?? null
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
    const shot = focus()
    if (shot?.open && shot.id !== room?.id) return
    if (isThought) {
      if (queue.some((line) => !line.isThought)) return
      queue = queue.filter((line) => line.agentId !== agentId)
      if (active?.isThought && active.agentId === agentId) active = null
    } else {
      queue = queue.filter((line) => !line.isThought)
      if (active?.isThought) active = null
    }
    queue.push({ agentId, text, sceneId: room?.id ?? null, isThought })
    if (queue.length > 2) queue.shift()
  }
  return {
    spawnSpeech: (agentId, text) => {
      spawn(agentId, text, false)
    },
    spawnThought: (agentId, text) => {
      spawn(agentId, text, true)
    },
    setSuppressed(value) {
      graveTone = value
      gateThoughts()
    },
    setThoughts(value) {
      viewer = value
      gateThoughts()
    },
    tick(time) {
      if (previousTime !== null && store.timeMoving()) clock += Math.max(0, time - previousTime)
      previousTime = time
      const now = clock
      let entering = false
      const tick = store.getTick(),
        live = store.getMode().live
      const view = store.viewSeq()
      const roomId = scene.interior?.activeId() ?? null
      if (tick < lastTick || live !== lastLive || view !== lastView || roomId !== lastRoom) clear()
      lastRoom = roomId
      lastView = view
      lastTick = tick
      lastLive = live
      if (document.hidden) {
        clear()
        return
      }
      const shot = focus()
      if (
        active &&
        (now - born > bubbleLife(active.text, active.isThought) ||
          !anchor(active.agentId) ||
          (shot?.open && active.sceneId !== shot.id))
      )
        active = null
      queue = queue.filter((line) => !shot?.open || line.sceneId === shot.id)
      if (
        active &&
        queue.length &&
        now - born >=
          Math.min(6000, Math.max(1400, 600 + active.text.trim().split(/\s+/).length * 230))
      )
        active = null
      if (!active && queue.length) {
        active = queue.shift()!
        born = now
        typed = -1
        const speaker = agentName(store.getState()?.agents, active.agentId)
        name.textContent = active.isThought ? `${speaker} · Thought` : speaker
        balloon.dataset.kind = active.isThought ? 'thought' : 'speech'
        ring.hidden = active.isThought
        reserved.textContent = active.text
        measureNeeded = true
        written.textContent = ''
        balloon.dataset.tint = tintOf(active.agentId)
        ring.dataset.tint = tintOf(active.agentId)
        entering = true
      }
      const at = active ? anchor(active.agentId) : null
      root.hidden = !at
      root.dataset.agentId = active?.agentId ?? ''
      root.dataset.sceneId = active?.sceneId ?? ''
      root.dataset.speaking = 'false'
      ring.hidden = !!active?.isThought || !!active?.sceneId
      if (!active || !at) return
      balloon.hidden = scene.getZoom() <= 0.5 && !scene.interior?.isActive()
      if (measureNeeded && !balloon.hidden) measure()
      if (entering && !reduced.matches)
        balloon.animate(
          [
            { opacity: 0, scale: '.96', translate: '0 5px' },
            { opacity: 1, scale: '1', translate: '0 0' },
          ],
          { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' },
        )
      const { w, h } = dimensions
      const width = scene.app.screen.width - (scene.safeInsets?.right ?? 0)
      const x = Math.max(12, Math.min(width - w - 12, at.x - w / 2))
      const top = (scene.safeInsets?.top ?? 0) + 24
      const maxY = scene.app.screen.height - (scene.safeInsets?.bottom ?? 0) - h - 12
      if (w + 24 > width || maxY < top) {
        root.hidden = true
        balloon.hidden = true
      }
      root.dataset.speaking = String(!balloon.hidden && !active.isThought)
      if (root.hidden) return
      const aboveY = at.y - h - 20
      const belowY = at.footY + 22
      const below = aboveY < top && belowY <= maxY
      const y = below ? belowY : Math.max(top, Math.min(maxY, aboveY))
      balloon.dataset.below = String(below)
      balloon.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
      balloon.style.setProperty('--tail-x', `${Math.max(16, Math.min(w - 16, at.x - x))}px`)
      const n =
        reduced.matches || active.isThought
          ? active.text.length
          : Math.min(active.text.length, Math.ceil(active.text.length * ((now - born) / 300)))
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
      resized.disconnect()
      document.fonts.removeEventListener('loadingdone', fontsReady)
      root.remove()
    },
  }
}
