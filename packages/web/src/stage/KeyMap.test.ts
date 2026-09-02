import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cameraActionFor } from '../render/cameraNav.js'
import { stageKeyFor } from './useStageKeys.js'
import { KEY_MAP, KEY_MAP_KEY, KeyMap } from './KeyMap.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')
const shut = renderToStaticMarkup(createElement(KeyMap, { open: false, onOpenChange: () => {} }))
const open = renderToStaticMarkup(createElement(KeyMap, { open: true, onOpenChange: () => {} }))

describe('the key map — heuristic 10 used to score zero', () => {
  it('★ is shut until it is asked for, and then says every key by name', () => {
    expect(shut).toBe('')
    expect(open).toContain('key-map-sheet')
    for (const row of KEY_MAP) {
      expect(open, row.says).toContain(row.says)
      for (const k of row.keys) expect(open, k).toContain(`>${k}</kbd>`)
    }
  })

  it('★ every key it claims is a key something actually binds', () => {
    const stage = KEY_MAP.filter((r) => r.keys.length === 1 && /^[A-Z]$/.test(r.keys[0] ?? ''))
    expect(stage.map((r) => r.keys[0])).toEqual(['S', 'F', 'D', 'T'])
    for (const r of stage) expect(stageKeyFor(r.keys[0]!), r.keys[0]).not.toBeNull()
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'Home'])
      expect(cameraActionFor(key), key).not.toBeNull()
  })

  it('★ opens on `?` — and the frame meter had to give the key up for it', () => {
    expect(KEY_MAP_KEY).toBe('?')
    // the meter now answers to Shift+P, and to nothing else
    expect(src('../ui/FpsOverlay.tsx')).not.toContain("'?'")
    expect(src('../ui/FpsOverlay.tsx')).toContain('e.shiftKey')
  })

  it('is a dialog with a name, and takes focus when it comes up', () => {
    expect(open).toContain('role="dialog"')
    expect(open).toContain('aria-label="What the town answers to"')
    expect(open).toContain('tabindex="-1"')
  })
})
