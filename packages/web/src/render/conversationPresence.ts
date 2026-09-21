import { agentName } from '@sj/shared'
import type { WorldStore, TownScene } from '../state/worldStore.js'
import type { Scene } from './scene.js'
import { agentScreenAnchor } from './agentAnchor.js'
import icons from '../paper/game/assets/flat-icons.png'
import './conversationPresence.css'

export function createConversationPresence(scene: Scene, store: WorldStore) {
  const parent = scene.app.canvas.parentElement!
  const root = document.createElement('div')
  root.className = 'conversation-presence'
  root.hidden = true
  const caption = document.createElement('div')
  caption.className = 'conversation-caption'
  caption.setAttribute('role', 'status')
  const names = document.createElement('strong')
  const status = document.createElement('span')
  const dots = document.createElement('i')
  dots.textContent = '···'
  dots.setAttribute('aria-hidden', 'true')
  const icon = document.createElement('span')
  icon.className = 'conversation-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.style.backgroundImage = `url(${icons})`
  caption.append(icon, names, status, dots)
  root.append(caption)
  parent.append(root)
  const rings = new Map<string, HTMLElement>()
  let current: TownScene | null = null,
    born = 0,
    ended: number | null = null
  let lastTick = store.getTick(),
    lastLive = store.getMode().live
  let lastView = store.viewSeq()
  let lastRoom = scene.interior?.activeId() ?? null
  const reset = () => {
    current = null
    ended = null
    for (const ring of rings.values()) ring.remove()
    rings.clear()
    root.hidden = true
  }
  const position = (node: HTMLElement, x: number, y: number) => {
    const transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
    if (node.style.transform !== transform) node.style.transform = transform
  }
  return {
    tick(now: number) {
      const tick = store.getTick(),
        live = store.getMode().live
      const view = store.viewSeq()
      const room = scene.interior?.activeId() ?? null
      if (tick < lastTick || live !== lastLive || view !== lastView || room !== lastRoom) reset()
      lastView = view
      lastRoom = room
      lastTick = tick
      lastLive = live
      if (document.hidden) {
        reset()
        return
      }
      const right = scene.app.screen.width - (scene.safeInsets?.right ?? 0)
      const top = (scene.safeInsets?.top ?? 0) + 16
      const bottom = scene.app.screen.height - (scene.safeInsets?.bottom ?? 0) - 18
      const anchor = (id: string) => {
        if (store.getState()?.agents[id]?.asleep) return null
        const at = agentScreenAnchor(scene, store, id)
        return at && at.x > 24 && at.x < right - 24 && at.footY > top && at.footY < bottom
          ? at
          : null
      }
      const open = store.openScenes()
      const shot = store.shotScene()
      const visible = (talk: TownScene) => talk.participants.some((id) => anchor(id))
      const selected =
        shot?.open && visible(shot)
          ? shot
          : (open.find((talk) => talk.id === current?.id && visible(talk)) ?? open.find(visible))
      if (current && !open.some((talk) => talk.id === current!.id)) {
        if (ended === null) {
          ended = now
          status.textContent = 'Conversation ended'
          root.dataset.phase = 'ended'
        }
        if (!selected && visible(current) && now - ended < 1000) return
        reset()
      }
      if (!selected) {
        reset()
        return
      }
      if (selected.id !== current?.id) {
        reset()
        current = selected
        born = now
      }
      current = selected
      const who = selected.participants
        .map((id) => agentName(store.getState()?.agents, id))
        .join(' & ')
      if (names.textContent !== who) names.textContent = who
      for (const [id, ring] of rings) {
        if (!selected.participants.includes(id)) {
          ring.remove()
          rings.delete(id)
        }
      }
      root.hidden = false
      root.dataset.sceneId = selected.id
      root.dataset.paused = String(!store.timeMoving())
      root.dataset.phase = now - born < 1800 ? 'opening' : 'open'
      const text = 'In conversation'
      if (status.textContent !== text) status.textContent = text
      const bubble = parent.querySelector<HTMLElement>('.pixel-speech-layer')
      const speaker =
        bubble &&
        !bubble.hidden &&
        bubble.dataset.speaking === 'true' &&
        bubble.dataset.sceneId === selected.id &&
        selected.participants.includes(bubble.dataset.agentId ?? '') &&
        anchor(bubble.dataset.agentId ?? '')
          ? bubble.dataset.agentId
          : null
      root.dataset.speaking = String(!!speaker)
      const points: { x: number; footY: number }[] = []
      for (const id of selected.participants) {
        const at = anchor(id)
        let ring = rings.get(id)
        if (!at) {
          if (ring) ring.hidden = true
          continue
        }
        if (!ring) {
          ring = document.createElement('div')
          ring.className = 'conversation-person'
          ring.dataset.person = id
          ring.setAttribute('aria-hidden', 'true')
          root.append(ring)
          rings.set(id, ring)
        }
        ring.hidden = false
        ring.dataset.role = speaker === id ? 'speaking' : speaker ? 'listening' : 'present'
        position(ring, at.x, at.footY)
        points.push(at)
      }
      if (!points.length) {
        reset()
        return
      }
      const x = points.reduce((sum, at) => sum + at.x, 0) / points.length
      const y = Math.max(...points.map((at) => at.footY)) + 28
      position(
        caption,
        Math.max(130, Math.min(right - 130, x)),
        Math.max(top, Math.min(bottom - 54, y)),
      )
    },
    destroy() {
      root.remove()
    },
  }
}
