// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { cameraActionFor } from '../render/cameraNav.js'
import { FpsOverlay } from '../ui/FpsOverlay.js'
import { KEY_MAP_KEY } from './KeyMap.js'
import { stageKeyAllowed, stageKeyFor } from './useStageKeys.js'

describe('the five keys the stage itself owns', () => {
  it('maps S, Esc, F, D and T, in either case', () => {
    expect(stageKeyFor('s')).toBe('signpost')
    expect(stageKeyFor('S')).toBe('signpost')
    expect(stageKeyFor('Escape')).toBe('escape')
    expect(stageKeyFor('f')).toBe('fullscreen')
    expect(stageKeyFor('D')).toBe('director')
    expect(stageKeyFor('t')).toBe('thoughts')
    expect(stageKeyFor('T')).toBe('thoughts')
  })

  // StageMount already binds these to the camera. A second binding pans twice per press.
  it('leaves the camera keys alone — every key the camera owns, and no exceptions', () => {
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      '+',
      '=',
      '-',
      '_',
      'Home',
    ]) {
      expect(cameraActionFor(key), `${key} is a camera key`).not.toBeNull()
      expect(stageKeyFor(key), `${key} must stay the camera's`).toBeNull()
    }
  })

  it('claims no key the camera claims', () => {
    for (const key of ['s', 'S', 'f', 'F', 'd', 'D', 't', 'T', 'Escape']) {
      expect(cameraActionFor(key), key).toBeNull()
    }
  })
})

describe('typing an s is a letter, never a signpost', () => {
  it('stands down inside a field', () => {
    expect(stageKeyAllowed('INPUT', false)).toBe(false)
    expect(stageKeyAllowed('TEXTAREA', false)).toBe(false)
    expect(stageKeyAllowed('SELECT', false)).toBe(false)
    expect(stageKeyAllowed('DIV', true)).toBe(false)
  })

  it('works everywhere else', () => {
    expect(stageKeyAllowed('BODY', false)).toBe(true)
    expect(stageKeyAllowed('BUTTON', false)).toBe(true)
    expect(stageKeyAllowed('', false)).toBe(true)
  })
})

// ★ Both listeners are on the window and neither reads the other's `defaultPrevented`, so a key
// two of them claim fires twice: `f` used to go fullscreen AND raise the frame meter.
describe('★ no other window listener in the tree claims a stage key', () => {
  const roots: { unmount: () => void }[] = []
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  async function meter(): Promise<() => boolean> {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => {
      root.render(createElement(FpsOverlay))
    })
    return () => host.querySelector('.fps-overlay') !== null
  }

  const press = async (key: string, shiftKey = false): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
    })
  }

  afterEach(async () => {
    await act(async () => {
      for (const root of roots.splice(0)) root.unmount()
    })
    document.body.replaceChildren()
  })

  it('★ leaves the frame meter on a key the stage does not own', async () => {
    const up = await meter()
    for (const key of ['s', 'S', 'f', 'F', 'd', 'D', 't', 'T', 'Escape', KEY_MAP_KEY]) {
      await press(key)
      expect(up(), `the meter and the stage both claim "${key}"`).toBe(false)
    }
    // and it is a chord, so the bare letter still belongs to whoever wants it next
    await press('p')
    expect(up()).toBe(false)
    await press('P', true)
    expect(up()).toBe(true)
  })

  it('★ the key map owns `?` alone', async () => {
    expect(stageKeyFor(KEY_MAP_KEY)).toBeNull()
    const up = await meter()
    await press(KEY_MAP_KEY)
    expect(up()).toBe(false)
  })
})
