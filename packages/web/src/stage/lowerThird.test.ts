import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPE_CHARS_PER_S, typedChars, typingMs } from '../render/converse.js'
import { CAPTION_HOLD_MS, captionClip, lowerThirdLine } from '../ui/broadcast.js'
import { BUST_DESK_PX, BUST_PX } from './Broadcast.js'

const SRC = readFileSync(new URL('./Broadcast.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
const APP = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

describe('★ the caption belongs to the shot, and goes with it', () => {
  it('★ is only ever the line of somebody the camera is on', () => {
    expect(SRC).toContain('return spoken !== null && shot.includes(spoken.agentId) ? spoken : null')
  })

  it('★ is handed the shot by the one owner of it, never by a second guess at the camera', () => {
    expect(APP).toMatch(/<LowerThird store=\{store\} shot=\{shot\.cast\}/)
    expect(APP).toMatch(/onShot=\{onShot\}/)
  })

  it('★ mounts at the desk as well as on the stream, at a quarter of the face', () => {
    expect(BUST_PX).toBe(96)
    expect(BUST_DESK_PX).toBe(28)
    expect(SRC).toContain('broadcast ? BUST_PX : BUST_DESK_PX')
    // the sheet draws the box at exactly the size the crop was computed for, or the head slides
    expect(CSS).toMatch(/\.lower-third-bust \{[^}]*width: 28px; height: 28px;/)
    expect(CSS).toMatch(
      /\[data-broadcast='on'\] \.lower-third-bust \{[^}]*width: 96px; height: 96px;/,
    )
    // ...and the desk never asks the paper for a headline it would not print
    expect(SRC).toContain('broadcast ? dispatchesFeed : NO_PAPER')
  })
})

describe('★ the line arrives at reading pace, and the slab does not grow under it', () => {
  it('★ is written onto the node per frame, never re-rendered per character', () => {
    expect(SRC).toContain('joinStageLoop')
    expect(SRC).toContain('node.textContent = words.slice(0, n)')
    expect(SRC).not.toContain('setState(words.slice')
  })

  it('★ the ghost holds the finished width, and takes no ink doing it', () => {
    expect(SRC).toMatch(/className="lower-third-ghost" aria-hidden="true"/)
    expect(CSS).toMatch(/\.lower-third-ghost \{ visibility: hidden; \}/)
    expect(CSS).toMatch(/\.lower-third-typed \{ position: absolute; inset: 0; \}/)
    expect(CSS).toMatch(/\.lower-third-words \{[^}]*position: relative;/)
  })

  it('★ types at the town’s own pace, the one the speech bubbles use', () => {
    expect(TYPE_CHARS_PER_S).toBe(28)
    expect(typedChars(10, 0)).toBe(0)
    expect(typedChars(10, 1000)).toBe(10)
    expect(typedChars(40, 500)).toBe(14)
    expect(typingMs(28)).toBe(1000)
  })

  it('★ the hold is time to READ: it starts when the line has finished arriving', () => {
    expect(CAPTION_HOLD_MS).toBe(6000)
    expect(SRC).toContain('CAPTION_HOLD_MS + (STILL ? 0 : typingMs(p.text.length))')
    // a caption clipped to its cap is five seconds of typing; six more is a sentence a viewer reads
    expect(typingMs(captionClip('x'.repeat(400)).length)).toBe(5000)
  })

  it('★ a viewer who asked for stillness gets the whole line at once', () => {
    expect(SRC).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(SRC).toMatch(/if \(STILL\) \{\s*node\.textContent = words/)
  })
})

describe('the line the slab carries', () => {
  it('is the speech while there is speech, and the paper only behind it', () => {
    const spoken = { agentId: 'nadia', name: 'Nadia', words: 'I will never forgive that.' }
    expect(lowerThirdLine(spoken, { title: 'Day 4', body: 'The well ran dry.' })).toEqual({
      kind: 'speech',
      agentId: 'nadia',
      name: 'Nadia',
      words: 'I will never forgive that.',
    })
    expect(lowerThirdLine(null, { title: 'Day 4', body: 'The well ran dry.' })?.kind).toBe(
      'dispatch',
    )
    expect(lowerThirdLine(null, null)).toBeNull()
  })
})
