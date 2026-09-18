import type { WorldStore } from '../state/worldStore.js'
import { stateWord, statusOf } from '../ui/status.js'
import type { Scene } from './scene.js'
import type { ActLayer } from './acts.js'
import { agentScreenAnchor } from './agentAnchor.js'
import { overheadRow } from './overhead.js'
import icons from '../paper/game/assets/flat-icons.png'
import '../ui/resident-tokens.css'

type Token = {
  node: HTMLDivElement
  badge: HTMLSpanElement
  icon: HTMLSpanElement
  label: HTMLSpanElement
  dots: HTMLSpanElement
  bar: HTMLSpanElement
  kind: string
  word: string
  at: string
  progress: string
}

export function createResidentTokens(scene: Scene, store: WorldStore, acts: ActLayer) {
  const host = scene.app.canvas.parentElement!
  const root = document.createElement('div')
  root.className = 'resident-token-layer'
  root.setAttribute('aria-hidden', 'true')
  host.append(root)
  const speech = host.querySelector<HTMLElement>('.pixel-speech-layer')
  const tokens = new Map<string, Token>()
  const visible = new Set<string>()
  let agents = Object.values(store.getState()?.agents ?? {})
  const off = store.subscribe(() => {
    agents = Object.values(store.getState()?.agents ?? {})
  })
  const create = (id: string): Token => {
    const node = document.createElement('div')
    node.className = 'resident-marker'
    node.dataset.agentId = id
    const badge = document.createElement('span')
    badge.className = 'resident-badge'
    const icon = document.createElement('span')
    const label = document.createElement('span')
    const dots = document.createElement('span')
    dots.className = 'resident-dots'
    for (let i = 0; i < 3; i++) dots.append(document.createElement('i'))
    const bar = document.createElement('span')
    bar.className = 'resident-progress'
    badge.append(icon, label, dots)
    node.append(badge, bar)
    root.append(node)
    return { node, badge, icon, label, dots, bar, kind: '', word: '', at: '', progress: '' }
  }
  return {
    tick() {
      const interior = scene.interior?.isActive() ?? false
      root.hidden = document.hidden || (!interior && scene.getZoom() <= 0.5)
      if (root.hidden) return
      const motion = scene.wantsMotion() && store.timeMoving() && !store.getPaused() ? 'on' : 'off'
      if (root.dataset.motion !== motion) root.dataset.motion = motion
      const tick = store.getTick()
      const shot = store.shotScene()
      visible.clear()
      for (const a of agents) {
        if (!a.alive || overheadRow(a, tick)?.urgent) continue
        const state = statusOf(a, tick)
        const deciding =
          store.getMode().live &&
          store.minds().get(a.id)?.state === 'deciding' &&
          (scene.pickedId === a.id || (shot?.open && shot.participants.includes(a.id)))
        const kind =
          state === 'asleep'
            ? 'asleep'
            : deciding
              ? 'thinking'
              : acts.working(a.id)
                ? 'working'
                : null
        if (!kind || (!speech?.hidden && speech?.dataset.agentId === a.id)) continue
        const at = agentScreenAnchor(scene, store, a.id)
        if (!at) continue
        const width = scene.app.screen.width,
          height = scene.app.screen.height
        if (
          at.x < 0 ||
          at.x > width ||
          at.y < (scene.safeInsets?.top ?? 0) + 46 ||
          at.footY > height - (scene.safeInsets?.bottom ?? 0)
        )
          continue
        visible.add(a.id)
        let token = tokens.get(a.id)
        if (!token) {
          token = create(a.id)
          tokens.set(a.id, token)
        }
        const word = kind === 'thinking' ? 'Thinking' : stateWord(a, tick)
        if (token.kind !== kind) {
          token.kind = kind
          token.node.dataset.state = kind
          token.icon.className =
            kind === 'thinking' ? 'control-icon control-icon-thoughts' : 'sj-icon'
          token.icon.style.backgroundImage = kind === 'thinking' ? '' : `url(${icons})`
          token.icon.style.backgroundPosition =
            kind === 'asleep' ? '0% 66.666667%' : kind === 'working' ? '33.333333% 33.333333%' : ''
          token.dots.hidden = kind !== 'thinking'
        }
        if (token.word !== word) {
          token.word = word
          token.label.textContent = word
        }
        const headY = a.asleep ? at.y + (at.footY - at.y) * 0.45 : at.y
        const position = `translate(${Math.round(at.x)}px, ${Math.round(headY - 10)}px)`
        if (token.at !== position) {
          token.at = position
          token.node.style.transform = position
        }
        const fraction = kind === 'working' ? acts.fractionOf(a.id) : null
        token.bar.hidden = fraction === null
        if (fraction !== null) {
          const progress = `scaleX(${fraction.toFixed(3)})`
          if (token.progress !== progress) {
            token.progress = progress
            token.bar.style.transform = progress
          }
          const top = `${Math.round(at.footY - at.y + 16)}px`
          if (token.bar.style.top !== top) token.bar.style.top = top
        }
      }
      for (const [id, token] of tokens)
        if (!visible.has(id)) {
          token.node.remove()
          tokens.delete(id)
        }
    },
    destroy() {
      off()
      tokens.clear()
      root.remove()
    },
  }
}
