import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CONSTRUCT_VOCABULARY, momentTitle, SceneKind } from '@sj/shared'
import { DirectorCue } from './DirectorCue.js'
import { type CueLine, type CueSlot, cueStep, NO_CUE_LINE } from './cueSlot.js'

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
describe('★ the two slots, and the order the four things claim them in', () => {
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

  // ★ A moment used to outrank everything and take the whole slot for six seconds, so the line
  // saying what the town was doing vanished mid-read. News and the thing itself are two slots.
  it('★ news stands over what the town is doing rather than taking its line', () => {
    const html = cue({ text: 'DIRECTOR · OMAR', moment: MOMENT, scene: SCENE, why: WHY })
    expect(html).toContain('Rahel died.')
    expect(html).toContain('the well · Nadia &amp; Yusuf')
    expect(html.indexOf('Rahel died.'), 'news reads above the standing line').toBeLessThan(
      html.indexOf('the well'),
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

  it('★ gives the news its own row instead of the room the standing line is in', () => {
    const news = /\.stage-cue-news \{([^}]*)\}/.exec(CSS.replace(/\s+/g, ' '))?.[1] ?? ''
    expect(news, 'the news line has no rule at all').not.toBe('')
    expect(news).toContain('flex-basis: 100%')
    expect(news).toContain('order: -1')
    const scene = /\.stage-cue\[data-scene='on'\] \{([^}]*)\}/.exec(CSS.replace(/\s+/g, ' '))?.[1]
    expect(scene, 'the stamp row would keep the news beside it').toContain('flex-wrap: wrap')
  })
})

// ★ ONE SLOT, FOUR CLAIMANTS, LAST WRITE WINS: a line a viewer was reading was replaced mid-read
// by an unrelated one and neither was ever finished. A slot now keeps a line until it has been
// readable at the town's own pace, and shows the newest thing that arrived while it waited.
describe('★ the dwell floor and the one-deep queue', () => {
  const line = (key: string): CueLine<string> => ({ key, line: key })
  const fresh = (): CueSlot<string> => ({ shown: NO_CUE_LINE, until: 0, waiting: NO_CUE_LINE })
  const A = line('Rahel died.')
  const B = line('Tomas finished the well.')
  const C = line('Nadia refused him.')

  it('★ holds a line for a beat plus the town’s own reading pace over its words', () => {
    const short = cueStep(fresh(), line('Oh.'), 0)
    const long = cueStep(fresh(), line('x'.repeat(28)), 0)
    // a beat to notice it at all, then 28 characters a second, which is TYPE_CHARS_PER_S
    expect(short.until).toBe(1000 + Math.ceil((3 * 1000) / 28))
    expect(long.until).toBe(2000)
    // and capped, so one long line cannot hold the slot against everything behind it
    expect(cueStep(fresh(), line('x'.repeat(400)), 0).until).toBe(4000)
  })

  it('★ queues a line that lands inside the floor, and shows it when the floor is up', () => {
    const held = cueStep(fresh(), A, 0)
    const inside = cueStep(held, B, 300)
    expect(inside.shown.key, 'the line being read was replaced').toBe(A.key)
    expect(inside.waiting.key).toBe(B.key)
    const after = cueStep(inside, inside.waiting, inside.until)
    expect(after.shown.key, 'the refused line was lost rather than shown next').toBe(B.key)
  })

  it('★ keeps the newest of two waiting lines and drops the one behind it, never shown stale', () => {
    const held = cueStep(fresh(), A, 0)
    const first = cueStep(held, B, 200)
    const queued = cueStep(first, C, 600)
    expect(first.shown.key, 'the older line was put on screen and taken off again').toBe(A.key)
    expect(queued.waiting.key).toBe(C.key)
    const after = cueStep(queued, queued.waiting, queued.until)
    expect(after.shown.key).toBe(C.key)
    expect(after.waiting.key, 'the older line still stands behind it').toBe(C.key)
  })

  it('★ the floor running out on an empty queue leaves the slot as it was', () => {
    const held = cueStep(fresh(), A, 0)
    expect(held.until, 'the line has no floor to run out at all').toBeGreaterThan(0)
    const later = cueStep(held, held.waiting, held.until + 5000)
    expect(later.shown.key, 'a timer blanked a line nothing was waiting to replace').toBe(A.key)
    expect(later.until).toBe(held.until)
  })

  it('★ two slots hold at once and neither takes the other’s line', () => {
    const news = cueStep(fresh(), A, 0)
    const doing = cueStep(fresh(), B, 0)
    const newsAgain = cueStep(news, C, 100)
    expect(doing.shown.key, 'news reached into the slot beside it').toBe(B.key)
    expect(newsAgain.shown.key).toBe(A.key)
    expect(cueStep(doing, doing.waiting, doing.until).shown.key).toBe(B.key)
  })

  // ★ The slot answers the world in ONE step. `waiting` is what the world last handed it, so the
  // component asks again only when the world moved, and a step never asks for another step.
  it('★ records what the world handed it, so one step settles the slot', () => {
    const held = cueStep(fresh(), A, 0)
    for (const [slot, next, now] of [
      [fresh(), A, 0],
      [held, B, 300],
      [held, B, 9000],
      [held, A, 300],
      [held, NO_CUE_LINE, 300],
    ] as const) {
      const step = cueStep(slot, next, now)
      expect(step.waiting.key, `${next.key} at ${now}`).toBe(next.key)
      expect(cueStep(step, next, now), 'the same line asked for a second step').toEqual(step)
    }
  })

  it('★ clears when the world holds nothing, once the line has had its floor', () => {
    const held = cueStep(fresh(), A, 0)
    const emptied = cueStep(held, NO_CUE_LINE, 300)
    expect(emptied.shown.key, 'the world going quiet wiped a line mid-read').toBe(A.key)
    const after = cueStep(emptied, emptied.waiting, emptied.until)
    expect(after.shown.line).toBeNull()
    expect(after.until).toBe(0)
  })
})
