// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { Scene } from '../render/scene.js'
import { createWorldStore } from '../state/worldStore.js'
import { DirectorMode } from './DirectorMode.js'
import { Signpost } from '../paper/Signpost.js'
import { ThoughtsButton } from '../stage/ThoughtsButton.js'
import {
  BUBBLE_IMPORTANCE,
  bubbleSubject,
  rememberThoughts,
  shouldBubble,
  thoughtsHidden,
  thoughtsSetting,
} from './thoughts.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const src = (f: string): string => readFileSync(join(import.meta.dirname, f), 'utf8')

type FakeScene = { pickedId: string | null; cameraSubject: string | null } & Record<string, unknown>

/** The Pixi handle the director writes to, holding only the fields a shot touches. */
const fakeScene = (): FakeScene => ({
  app: { screen: { width: 1280, height: 720 } },
  pickedId: null,
  cameraSubject: null,
  setZoom: () => {},
  setFollow: () => {},
  centerHome: () => {},
  pointOf: () => null,
  anchorOf: () => null,
})

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Mounts a tree and hands back its re-render, so a prop can change under a live one. */
async function mount(el: ReactElement): Promise<(next: ReactElement) => Promise<void>> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
  return async (next: ReactElement) => {
    await act(async () => {
      root.render(next)
    })
  }
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

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

describe('★ the importance gate over the heads', () => {
  const t = (agentId: string, importance: number) => ({ agentId, importance })
  const ALONE: readonly string[] = []

  // ★ Twelve minds thinking every turn is twelve wisps, which is the opposite of easy to
  // follow. The weight the mind gave the turn is what decides.
  it('★ draws a heavy thought and lets a light one go by', () => {
    expect(shouldBubble(t('omar', BUBBLE_IMPORTANCE), null, ALONE)).toBe(true)
    expect(shouldBubble(t('omar', 10), null, ALONE)).toBe(true)
    expect(shouldBubble(t('omar', BUBBLE_IMPORTANCE - 1), null, ALONE)).toBe(false)
    expect(shouldBubble(t('omar', 1), null, ALONE)).toBe(false)
  })

  // ★ The person the viewer is watching is the one whose head they are reading.
  it('★ keeps every thought of the camera subject, however light', () => {
    expect(shouldBubble(t('omar', 1), 'omar', ALONE)).toBe(true)
    expect(shouldBubble(t('omar', 1), 'leyla', ALONE)).toBe(false)
  })

  // ★ A room the town is holding open IS the thing being watched; its heads all speak.
  it('★ keeps every thought of anyone in the open scene', () => {
    expect(shouldBubble(t('leyla', 2), null, ['omar', 'leyla'])).toBe(true)
    expect(shouldBubble(t('tariq', 2), null, ['omar', 'leyla'])).toBe(false)
  })

  it('★ the gate is 6, and it is the same number the plan named', () => {
    expect(BUBBLE_IMPORTANCE).toBe(6)
  })

  // ★ Nobody clicks on a broadcast, and the auto-director is the camera most of the time: read
  // off the pick alone the gate had no subject at all and the wisps went to the heavy thoughts.
  it('★ takes the auto-director’s subject when the viewer has picked nobody', () => {
    expect(bubbleSubject({ pickedId: null, cameraSubject: 'omar' })).toBe('omar')
    expect(bubbleSubject({ pickedId: null, cameraSubject: null })).toBe(null)
    expect(
      shouldBubble(t('omar', 1), bubbleSubject({ pickedId: null, cameraSubject: 'omar' }), ALONE),
    ).toBe(true)
  })

  // ★ A hand on the lens outranks automation, here as at the camera.
  it('★ and the viewer’s own pick still wins over it', () => {
    expect(bubbleSubject({ pickedId: 'leyla', cameraSubject: 'omar' })).toBe('leyla')
    expect(
      shouldBubble(
        t('omar', 1),
        bubbleSubject({ pickedId: 'leyla', cameraSubject: 'omar' }),
        ALONE,
      ),
    ).toBe(false)
  })

  it('★ the director writes the subject the gate reads', async () => {
    const scene = fakeScene()
    await mount(
      createElement(DirectorMode, {
        store: createWorldStore(),
        scene: scene as unknown as Scene,
        autoCut: false,
        pinned: 'omar',
      }),
    )
    expect(scene.cameraSubject).toBe('omar')
    expect(bubbleSubject(scene)).toBe('omar')
    expect(shouldBubble(t('omar', 1), bubbleSubject(scene), ALONE)).toBe(true)
  })

  it('★ and the wisps move with the camera when the director turns to somebody else', async () => {
    const scene = fakeScene()
    const store = createWorldStore()
    const props = { store, scene: scene as unknown as Scene, autoCut: false }
    const again = await mount(createElement(DirectorMode, { ...props, pinned: 'omar' }))
    expect(scene.cameraSubject).toBe('omar')
    await again(createElement(DirectorMode, { ...props, pinned: 'leyla' }))
    expect(scene.cameraSubject).toBe('leyla')
    expect(shouldBubble(t('omar', 1), bubbleSubject(scene), ALONE)).toBe(false)
    expect(shouldBubble(t('leyla', 1), bubbleSubject(scene), ALONE)).toBe(true)
  })

  // ★ The T toggle is upstream of all of it: a viewer who turned the wisps off gets none,
  // subject and scene included. `bubbles.ts` asks `thoughtsHidden` before it draws.
  // The spawn loop lives inside the Pixi ticker closure, which no test can reach without a GPU,
  // so its two calls are read off the file. Everything either one decides is driven above.
  it('★ the spawner still asks the T gate, so this one never overrules it', () => {
    expect(src('../render/bubbles.ts')).toMatch(/isThought && thoughtsHidden\(/)
    expect(src('../render/StageMount.tsx')).toMatch(/shouldBubble\(t, bubbleSubject\(s\)/)
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
    const post = renderToStaticMarkup(createElement(Signpost, { open: null, onOpen: () => {} }))
    expect(post).not.toContain('thoughts')
    expect(post).not.toContain('Thought')
    expect(src('./chrome.css')).toContain('.help-button, .thoughts-button, .sound-button {')
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

// ★ A thought lands on the live socket while a scrubbed viewer is standing in a past minute.
// Drawn there it is a sentence over a head that the minute on screen never held.
describe('★ the wisp belongs to the minute it was thought in', () => {
  const t = { agentId: 'omar', importance: 10 }

  it('draws nothing at all while the clock on screen is stopped', () => {
    expect(shouldBubble(t, null, [], true)).toBe(true)
    expect(shouldBubble(t, null, [], false)).toBe(false)
    expect(shouldBubble(t, 'omar', ['omar'], false), 'not even the subject').toBe(false)
  })

  // Measured, not asserted from the brief: for the exact set the caret is drawn on, the shipped
  // gate already passes every thought, so an importance floor over them would change nothing.
  it('★ passes every weight for the cast and the pick, at every importance', () => {
    const weights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(
      weights.filter((n) => shouldBubble({ agentId: 'omar', importance: n }, 'omar', [])),
    ).toEqual(weights)
    expect(
      weights.filter((n) => shouldBubble({ agentId: 'omar', importance: n }, null, ['omar'])),
    ).toEqual(weights)
    // and for a stranger the floor is real, which is the whole reason the gate exists
    expect(
      weights.filter((n) => shouldBubble({ agentId: 'omar', importance: n }, null, [])),
    ).toEqual([6, 7, 8, 9, 10])
  })
})
