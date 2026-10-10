import { structureTitle, type SimConfig } from '@sj/shared'
import type { Structure } from '@sj/engine/state'
import icons from '../paper/game/assets/flat-icons.png'

export function buildingLabel(structure: Structure, config: SimConfig) {
  const construction = structure.stage === 'construction'
  const duration = config.structures.recipes[structure.kind]?.durationTicks
  const progress =
    duration && duration > 0
      ? ` · ${Math.min(100, Math.max(0, Math.floor((structure.progressTicks / duration) * 100)))}%`
      : ''
  return {
    name: structureTitle(structure),
    kind: construction ? 'construction' : structure.owner === undefined ? 'public' : 'private',
    icon: construction ? 5 : structure.owner === undefined ? 11 : 2,
    detail: construction ? `Under construction${progress}` : '',
  }
}

export function createBuildingLabel(root: HTMLElement) {
  const node = document.createElement('div')
  node.className = 'building-hover-label'
  node.hidden = true
  const icon = document.createElement('span')
  icon.className = 'sj-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.style.backgroundImage = `url(${icons})`
  const copy = document.createElement('span')
  const name = document.createElement('span')
  const detail = document.createElement('small')
  copy.append(name, detail)
  node.append(icon, copy)
  root.append(node)
  let previous = ''
  let measuredWidth = 0
  let measuredHeight = 0
  let viewportWidth = 0
  return {
    show(
      structure: Structure,
      config: SimConfig,
      x: number,
      y: number,
      width: number,
      height: number,
      safe: { top: number; right?: number; bottom: number },
    ) {
      const label = buildingLabel(structure, config)
      const key = JSON.stringify(label)
      const availableWidth = width - (safe.right ?? 0)
      const measure = key !== previous || availableWidth !== viewportWidth
      if (key !== previous) {
        previous = key
        node.dataset.kind = label.kind
        name.textContent = label.name
        detail.textContent = label.detail
        detail.hidden = label.detail === ''
        icon.style.backgroundPosition = `${((label.icon % 4) * 100) / 3}% ${(Math.floor(label.icon / 4) * 100) / 3}%`
      }
      node.hidden = false
      node.style.maxWidth = `${Math.max(0, availableWidth - 16)}px`
      if (measure) {
        measuredWidth = node.offsetWidth
        measuredHeight = node.offsetHeight
        viewportWidth = availableWidth
      }
      const w = measuredWidth,
        h = measuredHeight
      const top = safe.top + 8
      const bottom = height - safe.bottom - h - 8
      if (w + 16 > availableWidth || bottom < top) {
        node.hidden = true
        return
      }
      node.style.left = `${Math.max(8, Math.min(availableWidth - w - 8, x - w / 2))}px`
      node.style.top = `${Math.max(top, Math.min(bottom, y + 8))}px`
    },
    hide() {
      node.hidden = true
    },
    destroy() {
      node.remove()
    },
  }
}
