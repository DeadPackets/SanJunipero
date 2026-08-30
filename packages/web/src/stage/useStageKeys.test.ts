import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cameraActionFor } from '../render/cameraNav.js'
import { KEY_MAP_KEY } from './KeyMap.js'
import { stageKeyAllowed, stageKeyFor } from './useStageKeys.js'

describe('the four keys the stage itself owns', () => {
  it('maps S, Esc, F and D, in either case', () => {
    expect(stageKeyFor('s')).toBe('signpost')
    expect(stageKeyFor('S')).toBe('signpost')
    expect(stageKeyFor('Escape')).toBe('escape')
    expect(stageKeyFor('f')).toBe('fullscreen')
    expect(stageKeyFor('D')).toBe('director')
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
    for (const key of ['s', 'S', 'f', 'F', 'd', 'D', 'Escape']) {
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
  const FPS = readFileSync(new URL('../ui/FpsOverlay.tsx', import.meta.url), 'utf8')

  it('★ leaves the frame meter on a key the stage does not own', () => {
    const key = /e\.key\.toLowerCase\(\) !== '(.)'/.exec(FPS)![1]!
    expect(stageKeyFor(key), `the meter and the stage both claim "${key}"`).toBeNull()
    // and it is a chord, so the bare letter still belongs to whoever wants it next
    expect(FPS).toContain('e.shiftKey')
  })

  it('★ the key map owns `?` alone', () => {
    const MAP = readFileSync(new URL('./KeyMap.tsx', import.meta.url), 'utf8')
    expect(stageKeyFor(KEY_MAP_KEY)).toBeNull()
    expect(MAP).toContain('e.key !== KEY_MAP_KEY')
    expect(FPS).not.toContain("'?'")
  })
})
