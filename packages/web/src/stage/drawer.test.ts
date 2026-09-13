// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { GRIP_CLOSE_PX, GRIP_FLING_PX_MS } from '../paper/pageModel.js'
import { DossierRailBody } from './DossierRail.js'
import { DRAWER_LABEL, Drawer, drawerThrow } from './Drawer.js'

const roots: Root[] = []

/** happy-dom has no PointerEvent, and React reads `clientY`, `pointerId` and `timeStamp` off
 *  whatever native event arrives under the name. */
function pointer(el: Element, type: string, clientY: number, at = 0): void {
  const ev = new MouseEvent(type, { clientY, bubbles: true })
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  Object.defineProperty(ev, 'timeStamp', { value: at })
  el.dispatchEvent(ev)
}

async function mount(): Promise<{
  handle: HTMLButtonElement
  scrim: HTMLElement
  open: () => string | null
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(createElement(Drawer, null, createElement('p', { className: 'a-panel' }, 'in')))
  })
  return {
    handle: host.querySelector<HTMLButtonElement>('.drawer-handle')!,
    scrim: host.querySelector<HTMLElement>('.drawer-scrim')!,
    open: () => host.querySelector('.drawer-sheet')!.getAttribute('data-open'),
  }
}

/** One gesture on the handle, from `from` to `to` over `ms`. */
function swipe(el: Element, from: number, to: number, ms = 40): void {
  pointer(el, 'pointerdown', from, 0)
  pointer(el, 'pointermove', (from + to) / 2, ms / 2)
  pointer(el, 'pointerup', to, ms)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

describe('which way a throw on the handle points', () => {
  it('opens on a long pull up and closes on a long push down', () => {
    expect(drawerThrow(-(GRIP_CLOSE_PX + 1), 0)).toBe(true)
    expect(drawerThrow(GRIP_CLOSE_PX + 1, 0)).toBe(false)
  })

  it('answers a fast flick either way on the sheet’s own speed', () => {
    const fast = GRIP_FLING_PX_MS + 0.1
    expect(drawerThrow(-8, -fast)).toBe(true)
    expect(drawerThrow(8, fast)).toBe(false)
  })

  it('is neither for a short slow move, so a tap is left to the click', () => {
    expect(drawerThrow(0, 0)).toBeNull()
    expect(drawerThrow(-6, -0.1)).toBeNull()
    expect(drawerThrow(GRIP_CLOSE_PX - 1, 0.1)).toBeNull()
  })
})

describe('the phone drawer', () => {
  it('holds what it is given, and starts down', async () => {
    const d = await mount()
    expect(d.open()).toBe('no')
    expect(document.querySelector('.drawer-body .a-panel')?.textContent).toBe('in')
  })

  it('opens on a tap and closes on the next one', async () => {
    const d = await mount()
    await act(async () => {
      d.handle.click()
    })
    expect(d.open()).toBe('yes')
    expect(d.handle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      d.handle.click()
    })
    expect(d.open()).toBe('no')
  })

  it('opens on a swipe up and closes on a swipe down', async () => {
    const d = await mount()
    await act(async () => {
      swipe(d.handle, 800, 700)
    })
    expect(d.open()).toBe('yes')
    await act(async () => {
      swipe(d.handle, 700, 800)
    })
    expect(d.open()).toBe('no')
  })

  // ★ A drag ends in a click as well: without the guard the throw opened it and the click that
  // followed shut it in the same gesture.
  it('★ does not undo its own throw with the click that ends it', async () => {
    const d = await mount()
    await act(async () => {
      swipe(d.handle, 800, 700)
    })
    expect(d.open()).toBe('yes')
    await act(async () => {
      d.handle.click()
    })
    expect(d.open()).toBe('no')
  })

  it('closes on the scrim', async () => {
    const d = await mount()
    await act(async () => {
      d.handle.click()
    })
    await act(async () => {
      d.scrim.click()
    })
    expect(d.open()).toBe('no')
  })

  // The bar is the one new mark on a phone. It carries a name for a reader and no word at all
  // for a viewer, and it stands in Watch and Deck like every other panel it opens.
  it('says nothing on screen, is named for a reader, and is not up in Stage', async () => {
    const d = await mount()
    expect(d.handle.textContent).toBe('')
    expect(d.handle.getAttribute('aria-label')).toBe(DRAWER_LABEL)
    expect(d.handle.getAttribute('aria-controls')).toBe('drawer')
    expect(d.handle.className.split(' ')).toContain('at-watch')
  })
})

// ── the rail's own axis ──────────────────────────────────────────────────────────────────
// Twelve living bodies are 672px of card in a 623px rail at 1080p, and the last one sat under
// the mask fade with no way to reach it.
describe('the dossier rail with a full census', () => {
  const cards = Array.from({ length: 12 }, (_, i) => ({
    id: `a${String(i)}`,
    name: `Body ${String(i)}`,
    line: 'Between things',
    condition: null,
    pressure: 1 - i / 12,
    onScreen: i === 0,
    deciding: false,
    rank: i,
  }))

  it('draws every living body and tells the sheet how many rows to make room for', () => {
    const html = renderToStaticMarkup(createElement(DossierRailBody, { cards }))
    expect(html.match(/class="dossier-card[ "]/g)).toHaveLength(12)
    expect(html).toContain('--rows:12')
    expect(html).toContain('--rank:11')
  })
})
