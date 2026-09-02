import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ThoughtsButton } from '../stage/ThoughtsButton.js'
import { rememberThoughts, thoughtsHidden, thoughtsSetting } from './thoughts.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

const store = (seed?: string): Storage & { held: Map<string, string> } => {
  const held = new Map<string, string>()
  if (seed !== undefined) held.set('sj.thoughts', seed)
  return {
    held,
    getItem: (k) => held.get(k) ?? null,
    setItem: (k, v) => held.set(k, v),
    removeItem: (k) => {
      held.delete(k)
    },
    clear: () => {
      held.clear()
    },
    key: () => null,
    length: 0,
  }
}

describe('the thoughts setting', () => {
  // The null store is `storage.test.ts`'s roster; this is the empty one.
  it('shows the wisps to a viewer who has never said otherwise', () => {
    expect(thoughtsSetting(store())).toBe('shown')
  })

  it('round-trips the choice through storage', () => {
    const s = store()
    rememberThoughts(s, 'hidden')
    expect(s.held.get('sj.thoughts')).toBe('hidden')
    expect(thoughtsSetting(s)).toBe('hidden')
    rememberThoughts(s, 'shown')
    expect(thoughtsSetting(s)).toBe('shown')
  })

  // ★ A word, not a flag: an "asides only" state has to be able to arrive without reshaping
  // what an older build already wrote, and an older build must survive reading it.
  it('★ falls back to shown on a word this build does not know', () => {
    expect(thoughtsSetting(store('asides'))).toBe('shown')
  })

  it('★ takes a store that throws on every touch', () => {
    const angry = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }
    expect(thoughtsSetting(angry)).toBe('shown')
    expect(() => {
      rememberThoughts(angry, 'hidden')
    }).not.toThrow()
  })
})

describe('★ two hands on the wisp gate', () => {
  // ★ The ambient director calls `setSuppressed(false)` every time the town leaves a grave
  // hour. Read off one boolean, that would hand back wisps the viewer had turned off.
  it('★ either hand shuts them, and neither turns the other back on', () => {
    expect(thoughtsHidden(false, 'shown')).toBe(false)
    expect(thoughtsHidden(true, 'shown')).toBe(true)
    expect(thoughtsHidden(false, 'hidden')).toBe(true)
    expect(thoughtsHidden(true, 'hidden')).toBe(true)
  })

  // Speech is world fact and passes either way, so the gate is asked only for a thought.
  it('★ and the spawner asks the gate rather than a flag of its own', () => {
    expect(src('../render/bubbles.ts')).toMatch(/isThought && thoughtsHidden\(/)
  })
})

describe('the thoughts button', () => {
  const html = (thoughts: 'shown' | 'hidden'): string =>
    renderToStaticMarkup(createElement(ThoughtsButton, { thoughts, onToggle: () => {} }))

  // A switch, not a disclosure: it opens nothing, so `aria-pressed` and never `aria-expanded`.
  // Pressed is ON — the polarity `.legend-chip` set — and the label never restates the state.
  it('★ says which way it is set, and opens nothing', () => {
    expect(html('shown')).toContain('aria-pressed="true"')
    expect(html('hidden')).toContain('aria-pressed="false"')
    for (const t of ['shown', 'hidden'] as const) {
      expect(html(t)).toContain('aria-label="Thought bubbles"')
      expect(html(t)).not.toContain('aria-expanded')
    }
  })

  // ★ OFF IS A MARK, NOT A DARKER GROUND: the two states differ in shape before they differ in
  // any colour, which is the only signal a `forced-colors` viewer is left with.
  it('★ empties the wisp rather than swapping the paper', () => {
    const rects = (t: 'shown' | 'hidden'): number => html(t).match(/<rect/g)?.length ?? 0
    expect(rects('shown')).toBeGreaterThan(rects('hidden'))
    expect(src('./chrome.css')).not.toMatch(/\.thoughts-button\[aria-pressed[^}]*var\(--deep\)/)
  })

  // The post's four arms are the town's four sections; how the town is SHOWN is not a fifth.
  it('★ stands in the corner cluster, off the signpost', () => {
    expect(src('../paper/Signpost.tsx')).not.toContain('thoughts')
    expect(src('./chrome.css')).toContain('.help-button, .thoughts-button {')
  })

  // ★ `--deep-l` was used here and declared nowhere: an unresolved var makes the declaration
  // invalid at computed-value time, so the slab's ground fell out to transparent on hover.
  it('★ every token the cluster names is a token the sheet declares', () => {
    const css = src('./chrome.css')
    const block = /\/\* ── the corner cluster[\s\S]*?\n\n/.exec(css)?.[0] ?? ''
    expect(block).not.toBe('')
    for (const [, name] of block.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(css, name).toContain(`${name}:`)
    }
  })
})
