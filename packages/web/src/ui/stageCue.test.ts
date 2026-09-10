import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { InvitationRefused, PartnershipDissolved, PartnershipFormed } from '@sj/engine'
import type { TownScene } from '../state/worldStore.js'
import { DirectorCue } from '../stage/DirectorCue.js'
import { CHRONICLE_GLYPH } from './importantFeed.js'
import { contrast, tokens } from './contrast.test.js'
import {
  CUE_HOLD_MS,
  CUE_ICON_PX,
  CUE_QUEUE_MAX,
  CUE_TYPES,
  SCENE_SUMMARY_MS,
  STAKES_HOT,
  STAKES_MAX,
  STAKES_WARM,
  bodiesOf,
  cueFor,
  queuedCues,
  sceneCueFor,
  sceneNames,
  sceneStageOf,
  stakesBand,
} from './stageCue.js'

const src = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

// The cue reads two names and nothing else off the world, so the fixture is two names.
const town = (): WorldState =>
  ({
    agents: { amara: { id: 'amara', name: 'Amara' }, yusuf: { id: 'yusuf', name: 'Yusuf' } },
    structures: {},
  }) as unknown as WorldState

const ev = (type: string, payload: Record<string, unknown>): SimEvent => ({
  seq: 1,
  tick: 1,
  type,
  payload,
})

afterEach(() => {
  vi.useRealTimers()
})

// ★ The desk had one line of story chrome and it printed "DIRECTOR · name". Every law, custom,
// invention and bond change went straight to the paper, which is closed by default.
describe('★ the stage says what just happened', () => {
  const state = town()

  it('★ names a discovery, in the town’s own sentence and with the feed’s own glyph', () => {
    const cue = cueFor(
      ev('discovery_made', {
        recipeId: 'r1',
        name: 'smoked fish',
        kind: 'craft',
        byId: 'amara',
        intent: 'keep the catch',
        makes: ['smoked_fish'],
      }),
      state,
    )
    expect(cue?.text).toBe('Amara found the way of it, smoked fish.')
    expect(cue?.icon).toBe('key')
    expect(cue?.bodies).toEqual(['amara'])
  })

  it('★ names a bond change, and both the bodies it happened to', () => {
    const cue = cueFor(
      ev('partnership_formed', PartnershipFormed.parse({ aId: 'amara', bId: 'yusuf' })),
      state,
    )
    expect(cue?.text).toBe('Amara and Yusuf are partners now.')
    expect(cue?.icon).toBe('heart')
    expect(cue?.bodies).toEqual(['amara', 'yusuf'])

    const parted = cueFor(
      ev(
        'partnership_dissolved',
        PartnershipDissolved.parse({ aId: 'amara', bId: 'yusuf', byId: 'yusuf' }),
      ),
      state,
    )
    expect(parted?.text).toBe('Yusuf has left Amara.')
    expect(parted?.icon).toBe('flame')
    expect(parted?.bodies, 'the one who left is named first').toEqual(['yusuf', 'amara'])
  })

  it('★ leaves the shared roof and the private ask off the stage', () => {
    expect(cueFor(ev('co_slept', { aId: 'amara', bId: 'yusuf', day: 3 }), state)).toBeNull()
    expect(
      cueFor(
        ev(
          'invitation_refused',
          InvitationRefused.parse({
            agentId: 'amara',
            byId: 'yusuf',
            verb: 'lie_with',
            witnesses: [],
          }),
        ),
        state,
      ),
    ).toBeNull()
  })

  it('★ says a law in the same words the paper does, and says who broke one', () => {
    // One copy for the stage and the page: the chronicle's line, never a second table here.
    const agreed = cueFor(ev('law_ratified', { lawId: 'l1', text: 'No fire after dark' }), state)
    expect(agreed?.text).toContain('No fire after dark')
    expect(agreed?.text).toMatch(/^The town agreed/)
    const broken = cueFor(
      ev('law_broken', { lawId: 'l1', agentId: 'yusuf', verb: 'take', witnesses: [] }),
      state,
    )
    expect(broken?.text).toMatch(/^Yusuf did what the town agreed against/)
    expect(broken?.text).not.toMatch(/law_|l1/)
    expect(broken?.bodies).toEqual(['yusuf'])
  })

  it('stays quiet about everything else — the slot is for what the town decided', () => {
    for (const type of ['agent_moved', 'crop_harvested', 'item_moved', 'tick_advanced']) {
      expect(cueFor(ev(type, { agentId: 'amara' }), state), type).toBe(null)
    }
  })

  it('★ has a drawn glyph for every type it will print, never the fallback star by accident', () => {
    for (const type of CUE_TYPES) {
      const cue = cueFor(
        ev(type, {
          lawId: 'l1',
          agentId: 'amara',
          byId: 'amara',
          aId: 'amara',
          bId: 'yusuf',
          name: 'a thing',
          kind: 'craft',
          day: 1,
          verb: 'court',
          witnesses: [],
        }),
        state,
      )
      expect(cue, type).not.toBe(null)
      expect(CHRONICLE_GLYPH[cue!.icon], `${type} → ${cue!.icon}`).toBeDefined()
    }
  })

  it('names nobody it was not told about', () => {
    expect(bodiesOf(ev('tick_advanced', {}))).toEqual([])
  })
})

describe('★ the moment stands for six seconds, then the slot goes back to naming the shot', () => {
  it('holds for six seconds and draws a 16px pixel icon', () => {
    expect(CUE_HOLD_MS).toBe(6000)
    expect(CUE_ICON_PX).toBe(16)
  })

  // ★ THE QUEUE IS AT THE SOURCE. Three moments in one batch were three writes inside one
  // render, so a viewer read the third and the world's other two were never said at all.
  it('★ keeps every moment a batch carried, in the order the town said them', () => {
    const state = town()
    const batch = ['agent_died', 'agent_born', 'structure_completed'].map((type) =>
      ev(type, { agentId: 'amara', id: 'yusuf', byId: 'amara', name: 'a wall', kind: 'craft' }),
    )
    const queue = queuedCues([], batch, state)
    expect(queue.map((c) => c.text)).toEqual(batch.map((e) => cueFor(e, state)?.text))
    expect(new Set(queue.map((c) => c.text)).size, 'the three lines are three lines').toBe(3)
  })

  it('★ stands a later moment behind the one being read, never over it', () => {
    const state = town()
    const first = queuedCues([], [ev('agent_died', { agentId: 'amara' })], state)
    const both = queuedCues(first, [ev('agent_born', { id: 'yusuf', motherId: 'amara' })], state)
    expect(both[0]).toBe(first[0])
    expect(both).toHaveLength(2)
    // a batch that says nothing the stage prints leaves the queue exactly as it was
    expect(queuedCues(both, [ev('tick_advanced', {})], state)).toBe(both)
  })

  it('★ drops the middle of a burst rather than the line a viewer is reading', () => {
    const state = town()
    const burst = Array.from({ length: CUE_QUEUE_MAX + 3 }, (_, i) =>
      ev('law_ratified', { lawId: `l${String(i)}`, text: `No fire after dark ${String(i)}` }),
    )
    const queue = queuedCues([], burst, state)
    expect(queue).toHaveLength(CUE_QUEUE_MAX)
    expect(queue[0]?.text).toContain('dark 0')
    expect(queue[queue.length - 1]?.text).toContain(`dark ${String(burst.length - 1)}`)
  })

  // What the App does with these is driven in `directorsCut.test.ts`, where it is rendered.
  it('★ the cue slot draws the moment the feed’s own glyph, at the feed’s own size', () => {
    const cue = cueFor(ev('agent_died', { agentId: 'amara' }), town())!
    const html = renderToStaticMarkup(
      createElement(DirectorCue, { text: null, moment: cue, scene: null }),
    )
    expect(html).toContain(`width="${String(CUE_ICON_PX)}"`)
    expect(
      html.match(/<rect/g),
      'the glyph was drawn from something other than the feed',
    ).toHaveLength(CHRONICLE_GLYPH[cue.icon]!.pixels.length)
  })

  // ★ The bounce the two bodies take is driven over a real director in `render/ambient.test.ts`:
  // a bond formed lifts both of them and the grave tone lands them again.

  it('fades rather than blinking out, and holds still under reduced motion', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    expect(CSS).toMatch(/\.stage-cue \{[^}]*opacity: 1/)
    const guarded =
      /@media \(prefers-reduced-motion: no-preference\) \{(?:(?!@media)[\s\S])*?\.stage-cue \{ transition: opacity/
    expect(CSS, 'every motion in the sheet lives inside the no-preference guard').toMatch(guarded)
  })
})

// ★ THE SLOT SAYS WHAT THE TOWN IS DOING. A moment is news and is gone in six seconds; a scene
// is the thing itself and stands for as long as the room talks.
const NAMES = {
  amara: { name: 'Amara' },
  salma: { name: 'Salma' },
  nadir: { name: 'Nadir' },
  yusuf: { name: 'Yusuf' },
}

const scene = (over: Partial<TownScene> = {}): TownScene => ({
  id: 'sc_1',
  kind: 'talk',
  participants: ['amara', 'salma'],
  topic: 'At the well',
  stakes: 2,
  open: true,
  ...over,
})

describe('★ the lower third says what is happening', () => {
  it('★ names the topic and the people, in the town’s own words', () => {
    const cue = sceneCueFor(sceneStageOf(scene(), null), NAMES)
    expect(cue?.text).toBe('At the well · Amara & Salma')
    expect(cue?.kind).toBe('talk')
  })

  it('joins a room of three, and counts one bigger than that', () => {
    expect(sceneNames(['amara'], NAMES)).toBe('Amara')
    expect(sceneNames(['amara', 'salma'], NAMES)).toBe('Amara & Salma')
    expect(sceneNames(['amara', 'salma', 'nadir'], NAMES)).toBe('Amara, Salma & Nadir')
    expect(sceneNames(['amara', 'salma', 'nadir', 'yusuf'], NAMES)).toBe('Amara & 3 others')
  })

  it('says who without a topic, rather than an empty separator', () => {
    expect(sceneCueFor(sceneStageOf(scene({ topic: null }), null), NAMES)?.text).toBe(
      'Amara & Salma',
    )
    expect(sceneCueFor(sceneStageOf(scene({ topic: '  ' }), null), NAMES)?.text).toBe(
      'Amara & Salma',
    )
  })

  it('★ hands the slot to the summary when the scene closes', () => {
    const closed = scene({ open: false, summary: '  They agreed to dig deeper.  ' })
    const cue = sceneCueFor(sceneStageOf(closed, null), NAMES)
    expect(cue?.text).toBe('They agreed to dig deeper.')
  })

  it('★ the beat takes the slot over the summary when the close carries one', () => {
    const closed = scene({
      open: false,
      summary: 'Omar asked Salma to eat before working because her shoulder hurt.',
      beat: ' Omar sends Salma to eat first. Her shoulder is worse. ',
    })
    const cue = sceneCueFor(sceneStageOf(closed, null), NAMES)
    expect(cue?.text).toBe('Omar sends Salma to eat first. Her shoulder is worse.')
  })

  it('★ clears eight seconds after the close, and not before', () => {
    expect(SCENE_SUMMARY_MS).toBe(8000)
    const closed = scene({ open: false, summary: 'They agreed.' })
    expect(sceneStageOf(closed, null)?.phase).toBe('summary')
    // the hold has run out on THIS scene, named by its own id
    expect(sceneStageOf(closed, 'sc_1')).toBe(null)
    expect(sceneStageOf(closed, 'sc_other')?.phase).toBe('summary')
  })

  it('an open scene is never cleared by a hold that ran out on its own id', () => {
    expect(sceneStageOf(scene(), 'sc_1')?.phase).toBe('open')
  })

  it('clears at once on a close with nothing to say — an empty line is not a summary', () => {
    expect(sceneStageOf(scene({ open: false }), null)).toBe(null)
    expect(sceneStageOf(scene({ open: false, summary: '   ' }), null)).toBe(null)
  })

  it('has nothing to print with no scene, and nothing to print about nobody', () => {
    expect(sceneStageOf(null, null)).toBe(null)
    expect(sceneCueFor(null, NAMES)).toBe(null)
    expect(sceneCueFor(sceneStageOf(scene({ topic: null, participants: [] }), null), NAMES)).toBe(
      null,
    )
  })

  it('names nobody it was not told about — an id never reaches the slot', () => {
    expect(sceneNames(['stranger'], NAMES)).toBe('someone')
  })
})

describe('★ a quarrel at nine does not look like a talk at two', () => {
  it('reads the stakes as three bands, not as a number', () => {
    expect([0, 1, 3].map(stakesBand)).toEqual(['quiet', 'quiet', 'quiet'])
    expect([STAKES_WARM, 5, 7].map(stakesBand)).toEqual(['warm', 'warm', 'warm'])
    expect([STAKES_HOT, 9, STAKES_MAX].map(stakesBand)).toEqual(['hot', 'hot', 'hot'])
  })

  it('★ carries the kind and the band, so the two scenes cannot draw the same', () => {
    const talk = sceneCueFor(sceneStageOf(scene(), null), NAMES)
    const quarrel = sceneCueFor(sceneStageOf(scene({ kind: 'quarrel', stakes: 9 }), null), NAMES)
    expect([talk?.kind, talk?.band, talk?.stakes]).toEqual(['talk', 'quiet', 2])
    expect([quarrel?.kind, quarrel?.band, quarrel?.stakes]).toEqual(['quarrel', 'hot', 9])
  })

  it('★ drops the stakes on the close: a live pressure, never a verdict', () => {
    const cue = sceneCueFor(
      sceneStageOf(scene({ kind: 'quarrel', stakes: 9, open: false, summary: 'Settled.' }), null),
      NAMES,
    )
    expect(cue?.stakes).toBe(null)
    expect(cue?.band).toBe('quiet')
  })

  it('★ every band clears AA on the stamp’s own ground', () => {
    const T = tokens(src('./chrome.css'))
    for (const ink of ['cream-quiet', 'honey', 'ember']) {
      expect(contrast(T[ink]!, T.deep!), `--${ink} on --deep`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('★ says the stakes in a second channel, because colour is never the only one', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    // a rule along the stamp's foot, as long a fraction of it as the scene is worth
    expect(CSS).toMatch(
      /\.stage-scene-stamp::after \{[^}]*width: calc\(var\(--stakes, 0\) \* 100%\)/,
    )
    expect(CSS).toMatch(/\.stage-scene-stamp\[data-stakes='hot'\] \{ color: var\(--ember\)/)
    // ...and a third for anyone who cannot see either
    const cue = sceneCueFor(sceneStageOf(scene({ kind: 'quarrel', stakes: 9 }), null), NAMES)
    const html = renderToStaticMarkup(
      createElement(DirectorCue, { text: null, moment: null, scene: cue }),
    )
    expect(html).toContain(`<span class="stage-sr">, 9 of ${String(STAKES_MAX)} at stake</span>`)
  })

  // Measured in a headless shot at 390px: `balance` shrinks a flex item to equalise its lines,
  // which left the sentence 117px wide with 100px of slot standing empty on either side of it.
  it('★ sets the line as a chyron, so a phone gets the whole stage to read on', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    const scene = /\.stage-cue\[data-scene='on'\] \{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(scene, 'a sentence is body text, never a balanced heading').toContain(
      'text-wrap: pretty',
    )
    // a WIDTH: shrink-to-fit would equalise the chyron's lines instead of ranging them left
    expect(scene).toMatch(/width: 100%/)
    expect(scene, 'the stamp sits on the sentence’s first line').toContain('align-items: baseline')
    // and the cap that keeps it off the signpost still composes with that width
    expect(CSS).toMatch(
      /@media \(min-width: 700px\) \{ \.stage-cue \{ max-width: min\(calc\(60ch \+ var\(--cue-aside\)\), calc\(100% - 320px\)\)/,
    )
  })

  // A WIDTH, not only a cap: `left: 50%` with no `right` leaves shrink-to-fit half the stage to
  // work in, and every plate on the centre line is the same shape.
  it('★ gives every centred plate a width, not only a cap', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    for (const sel of ['.stage-cue', '.replay-card']) {
      const body = new RegExp(`\\${sel} \\{([^}]*)\\}`).exec(CSS)?.[1] ?? ''
      expect(body, sel).not.toContain('left: 50%')
      // the frame's own row is the width now, so shrink-to-fit is bounded by the stage and
      // not by half of it, and the plate says which row it stands in
      expect(body, sel).toMatch(/grid-area: (?:cue|third)/)
      expect(body, sel).toContain('justify-self: center')
    }
  })

  it('★ the stamp is the sheet’s own slab, and survives forced colours', () => {
    const CSS = src('./chrome.css').replace(/\s+/g, ' ')
    expect(CSS).toMatch(/\.stage-scene-stamp \{[^}]*box-shadow: var\(--frame\)/)
    expect(CSS).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.stage-scene-stamp/)
  })

  // ★ The App feeding this slot off the one hold, and striking the stamp once, is driven in
  // `directorsCut.test.ts`: the scene the shot is on stands on the glass once.
})
