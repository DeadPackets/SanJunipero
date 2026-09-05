import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CONSTRUCT_VOCABULARY, momentTitle, SceneKind } from '@sj/shared'
import { DirectorCue } from './DirectorCue.js'

// ★ `council` is a construct type, and the stamp was printing the enum id straight from the
// wire. One-way glass: the machinery's own word must never be struck onto the picture.
describe('★ the scene stamp is prose, never the wire’s own word for the scene', () => {
  const SRC = readFileSync(new URL('./DirectorCue.tsx', import.meta.url), 'utf8')
  const stamp = /function SceneStamp\([\s\S]*?\n\}/.exec(SRC)![0]

  it('★ renders the town’s title for the kind, not the kind', () => {
    expect(stamp, 'the raw enum id was the stamp text').not.toMatch(/\{kind\}/)
    expect(stamp).toContain('momentTitle(kind, null)')
  })

  it('★ no kind the gateway can send carries an ops word onto the glass', () => {
    for (const kind of SceneKind.options) {
      const word = momentTitle(kind, null)
      expect(word, kind).not.toBe(kind)
      for (const ops of CONSTRUCT_VOCABULARY)
        expect(word.toLowerCase(), `${kind} -> ${word}`).not.toContain(ops.toLowerCase())
    }
  })
})

// ★ WHY THE CAMERA IS HERE. The gateway scores the town and says so in one sentence; the slot
// prints it under the shot, in the sentence case a thing the town could have said is set in.
describe('★ the one line, and the order the four things claim it in', () => {
  const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8')
  const cue = (props: Parameters<typeof DirectorCue>[0]): string =>
    renderToStaticMarkup(createElement(DirectorCue, props))
  const WHY = 'Nadia & Yusuf — falling out, a slight'
  const MOMENT = { text: 'Rahel died.', icon: 'star', bodies: ['rahel'] }
  const SCENE = {
    kind: 'quarrel' as const,
    text: 'the well · Nadia & Yusuf',
    stakes: 8,
    band: 'hot' as const,
  }

  it('★ a moment outranks everything: it is news, and it is gone in six seconds', () => {
    expect(cue({ text: 'DIRECTOR · OMAR', moment: MOMENT, scene: SCENE, why: WHY })).toContain(
      'Rahel died.',
    )
  })

  it('★ what the town is DOING outranks why the camera came to watch it', () => {
    const html = cue({ text: 'DIRECTOR · OMAR', moment: null, scene: SCENE, why: WHY })
    expect(html).toContain('the well · Nadia &amp; Yusuf')
    expect(html).not.toContain('falling out')
  })

  it('★ the why takes the slot from the shot’s own caption', () => {
    const html = cue({ text: 'DIRECTOR · OMAR', moment: null, scene: null, why: WHY })
    expect(html).toContain('data-why="on"')
    expect(html).toContain('falling out, a slight')
    expect(html).not.toContain('DIRECTOR · OMAR')
  })

  it('★ and hands it back when the gateway has nothing to say', () => {
    for (const why of [null, '', '   ']) {
      expect(cue({ text: 'FOLLOWING · OMAR', moment: null, scene: null, why })).toContain(
        'FOLLOWING · OMAR',
      )
    }
    expect(cue({ text: null, moment: null, scene: null, why: null })).toBe('')
  })

  it('★ is set in sentence case, not shouted in the caption’s capitals', () => {
    expect(CSS).toContain(
      ".stage-cue[data-why='on'] { letter-spacing: 0.04em; text-transform: none; }",
    )
  })
})
