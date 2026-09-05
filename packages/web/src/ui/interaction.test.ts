import { describe, expect, it } from 'vitest'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, structureTitle } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { readFileSync } from 'node:fs'
import { PLATE_MAX_ROWS } from './plateModel.js'
import { stateWord } from './status.js'
import {
  CROP_STAGES,
  escapeStep,
  hoverPlate,
  itemCropDetail,
  thingKind,
  type StageUp,
} from './interaction.js'

function fixture(): WorldState {
  const s = genesisState(DEFAULT_CONFIG)
  return {
    ...s,
    agents: {
      rahel: { ...blankAgent('rahel', 'Rahel') },
      builder: { ...blankAgent('builder', 'Tomas') },
    },
    structures: {
      // built by one hand, owned by another — the plate reads `owner`, never `builtBy`.
      h1: { ...structure('h1', 'house', 'builder'), owner: 'rahel' },
      h2: { ...structure('h2', 'storehouse', null) },
      h3: { ...structure('h3', 'shed', 'ghost') }, // builder id no longer in the roster
    },
    items: {
      i1: { id: 'i1', kind: 'bread', qty: 3, loc: { t: 'tile', x: 1, y: 1 } },
      i2: { id: 'i2', kind: 'bread', qty: 3, owner: 'rahel', loc: { t: 'tile', x: 2, y: 2 } },
      i3: { id: 'i3', kind: 'axe', qty: 1, owner: 'nobody', loc: { t: 'tile', x: 3, y: 3 } },
    },
    crops: {
      c1: { id: 'c1', kind: 'wheat', x: 4, y: 4, plantedDay: 2, stage: 3, withered: false },
    },
  }
}

function blankAgent(id: string, name: string): WorldState['agents'][string] {
  return {
    id,
    name,
    x: 0,
    y: 0,
    alive: true,
    asleep: false,
    needs: { hunger: 1, energy: 1, warmth: 1, social: 1 },
    hp: 10,
    injuries: [],
    ill: false,
    ageDays: ADULT_AGE_DAYS,
    skills: {},
    activity: null,
    collapsedSinceTick: null,
    zeroHungerSinceTick: null,
  }
}

function structure(
  id: string,
  kind: string,
  builtBy: string | null,
): WorldState['structures'][string] {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    hp: 10,
    maxHp: 10,
    flammable: true,
    stage: 'complete',
    progressTicks: 0,
    builtBy,
    burning: false,
    burnTicks: 0,
  }
}

const words = (rows: { text: string }[]): string => rows.map((r) => r.text).join(' / ')

describe('hoverPlate — three lines at most, and none of them an id', () => {
  const state = fixture()

  it('gives a person their name and the one word for what they are doing', () => {
    const rows = hoverPlate(state, 'agent', 'rahel')
    expect(rows.map((r) => r.tone)).toEqual(['name', 'quiet'])
    expect(rows[0]?.text).toBe('Rahel')
    expect(rows[1]?.text).toBe(stateWord(state.agents.rahel!, state.tick))
  })

  // ★ A picked building wore three labels at once — its carved name, the nameplate under it and
  // this plate — and the plate's own first line repeated what the nameplate had just said.
  it('★ drops the kind line for the thing the viewer has already picked', () => {
    const named = { ...state, structures: { ...state.structures } }
    named.structures.h1 = { ...named.structures.h1!, name: 'The Long House' }
    expect(words(hoverPlate(named, 'structure', 'h1'))).toBe('house / The Long House / Rahel’s')
    expect(words(hoverPlate(named, 'structure', 'h1', true))).toBe('The Long House / Rahel’s')
    expect(hoverPlate(named, 'structure', 'h1', true).map((r) => r.tone)).not.toContain('kind')
  })

  it('★ keeps the kind line where no name is left to lead with', () => {
    // Nothing is carved into h2, so the kind IS its name and dropping it would empty the plate;
    // a heap of bread with its kind taken off is a quantity of nothing.
    expect(words(hoverPlate(state, 'structure', 'h2', true))).toBe('storehouse')
    expect(words(hoverPlate(state, 'item', 'i1', true))).toBe('bread / ×3')
    // A person's plate never led with a kind, so a pick leaves it exactly as it was.
    expect(hoverPlate(state, 'agent', 'rahel', true)).toEqual(hoverPlate(state, 'agent', 'rahel'))
  })

  it('leads a building with its kind and never credits a builder', () => {
    expect(hoverPlate(state, 'structure', 'h1')[0]).toEqual({ text: 'house', tone: 'kind' })
    expect(words(hoverPlate(state, 'structure', 'h2'))).toBe('storehouse')
    expect(words(hoverPlate(state, 'structure', 'h3'))).toBe('shed')
  })

  it("takes the owner line from the structure's owner, never from who built it", () => {
    // `builtBy` is 'script' at genesis, which is nobody in the town; `owner` is the person.
    expect(state.structures.h1?.builtBy).toBe('builder')
    expect(words(hoverPlate(state, 'structure', 'h1'))).toBe('house / Rahel’s')
    // ...and a builder who is nobody leaves the plate rather than being printed
    expect(words(hoverPlate(state, 'structure', 'h3'))).toBe('shed')
  })

  it('says who is under the roof, and counts them once there are too many to name', () => {
    const two = { ...state, agents: { ...state.agents } }
    two.agents.rahel = { ...two.agents.rahel!, insideId: 'h1' }
    two.agents.builder = { ...two.agents.builder!, insideId: 'h1' }
    expect(words(hoverPlate(two, 'structure', 'h1'))).toBe('house / Rahel’s / Rahel & Tomas inside')

    const crowd = { ...two, agents: { ...two.agents } }
    for (const n of ['x', 'y', 'z']) {
      crowd.agents[n] = { ...blankAgent(n, n.toUpperCase()), insideId: 'h1' }
    }
    expect(hoverPlate(crowd, 'structure', 'h1')[2]?.text).toBe('5 inside')
  })

  it('gives a carved name the name line and moves the owner down to the quiet one', () => {
    const named = { ...state, structures: { ...state.structures } }
    named.structures.h1 = { ...named.structures.h1!, name: 'The Long House' }
    expect(words(hoverPlate(named, 'structure', 'h1'))).toBe('house / The Long House / Rahel’s')
  })

  it('never draws more lines than the plate has', () => {
    for (const kind of ['agent', 'structure', 'item', 'crop'] as const) {
      const id = { agent: 'rahel', structure: 'h1', item: 'i2', crop: 'c1' }[kind]
      expect(hoverPlate(state, kind, id).length, kind).toBeLessThanOrEqual(PLATE_MAX_ROWS)
    }
  })

  it('counts an item and marks it when someone in the town owns it', () => {
    expect(words(hoverPlate(state, 'item', 'i1'))).toBe('bread / ×3')
    expect(words(hoverPlate(state, 'item', 'i2'))).toBe('bread / ×3 · Rahel’s')
  })

  // The invariant, applied to a thing as well as to a building: genesis signs its own work with
  // a runner who is nobody, and an owner outside the town is left unsaid rather than printed.
  it('leaves an owner the town does not have unsaid, rather than printing their id', () => {
    expect(words(hoverPlate(state, 'item', 'i3'))).toBe('axe / ×1')
  })

  it('shows how far a crop has come', () => {
    expect(words(hoverPlate(state, 'crop', 'c1'))).toBe(`wheat / stage 3 of ${CROP_STAGES}`)
  })

  it('draws nothing at all for anything the town does not have', () => {
    for (const kind of ['agent', 'structure', 'item', 'crop'] as const) {
      expect(hoverPlate(state, kind, 'nope'), kind).toEqual([])
    }
    expect(hoverPlate(null, 'agent', 'rahel')).toEqual([])
  })
})

describe('structureTitle — a proper name outranks the kind, wherever a viewer reads one', () => {
  const named = { ...structure('n1', 'house', null), name: '  Yusuf’s   house ' }
  const carved = {
    ...structure('n2', 'house', null),
    inscription: { text: 'The Long Table', by: 'rahel' },
  }
  const blank = { ...structure('n3', 'house', null), inscription: { text: '  ', by: 'rahel' } }
  it('★ reads the carved name, flattened exactly as speech is', () => {
    expect(structureTitle(named)).toBe('Yusuf’s house')
  })

  it('falls back to the inscription, and past an inscription of nothing to the kind', () => {
    expect(structureTitle(carved)).toBe('The Long Table')
    expect(structureTitle(blank)).toBe('house')
    expect(structureTitle(structure('n4', 'fire_pit', null))).toBe('fire pit')
  })

  it('★ and the hover reads it off the world, saying nothing about a building that is gone', () => {
    const titled = { structures: { n1: named }, agents: {} } as unknown as WorldState
    expect(hoverPlate(titled, 'structure', 'n1').map((r) => r.text)).toEqual([
      'house',
      'Yusuf’s house',
    ])
    expect(hoverPlate(titled, 'structure', 'nope')).toEqual([])
  })
})

describe('escape puts down one thing at a time, topmost first', () => {
  const up = (over: Partial<StageUp> = {}): StageUp => ({
    keys: false,
    paper: false,
    interior: false,
    subject: false,
    fullscreen: false,
    ...over,
  })

  it('★ the sheet comes down before the room, the room before the pick', () => {
    expect(escapeStep(up({ paper: true, interior: true, subject: true }))).toBe('paper')
    expect(escapeStep(up({ interior: true, subject: true }))).toBe('interior')
    expect(escapeStep(up({ subject: true }))).toBe('subject')
  })

  it('★ fullscreen is the last rung, never the first', () => {
    expect(escapeStep(up({ paper: true, fullscreen: true }))).toBe('paper')
    expect(escapeStep(up({ subject: true, fullscreen: true }))).toBe('subject')
    expect(escapeStep(up({ fullscreen: true }))).toBe('fullscreen')
  })

  it('★ the key map is the top rung — it is the sheet a lost viewer just opened', () => {
    expect(escapeStep(up({ keys: true, paper: true, subject: true }))).toBe('keys')
    expect(escapeStep(up({ keys: true }))).toBe('keys')
  })

  it('★ answers nothing when the town is already bare', () => {
    expect(escapeStep(up())).toBeNull()
  })

  it('★ nothing else in the web tree listens for Escape', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const f of ['../paper/Paper.tsx', '../stage/SubjectRing.tsx', '../stage/KeyMap.tsx'])
      expect(src(f), f).not.toContain('Escape')
    expect(src('../App.tsx')).toContain('escapeStep(')
  })

  // ★ The rig published a ground click and NOBODY subscribed, so the only way to put a ring
  // down was the keyboard. A click on bare ground is the other half of Escape's bottom rung.
  it('★ a click on bare ground puts the pick down, the way Escape does', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
    expect(src('../render/StageMount.tsx')).toContain('s.onTilePointer(')
    expect(src('../App.tsx')).toMatch(
      /onGround=\{\(\) => \{\s*setSubject\(null\)\s*setThing\(null\)/,
    )
  })
})

describe('itemCropDetail — the click line the record answers with', () => {
  const state = fixture()

  it('says what a thing is, how many, and whose', () => {
    expect(itemCropDetail(state, { kind: 'item', id: 'i2' })).toBe('bread ×3, owned by Rahel')
    expect(itemCropDetail(state, { kind: 'item', id: 'i1' })).toBe('bread ×3, claimed by no one')
  })

  it('says how far along a crop is, and when it went in', () => {
    expect(itemCropDetail(state, { kind: 'crop', id: 'c1' })).toBe(
      `wheat, planted on day 2, stage 3 of ${CROP_STAGES}`,
    )
  })

  it('has nothing to say about a thing that is gone', () => {
    expect(itemCropDetail(state, { kind: 'item', id: 'gone' })).toBeNull()
    expect(itemCropDetail(null, { kind: 'crop', id: 'c1' })).toBeNull()
  })

  it('names the engine kind the record indexes by, and nothing for a thing that is gone', () => {
    expect(thingKind(state, { kind: 'item', id: 'i3' })).toBe('axe')
    expect(thingKind(state, { kind: 'crop', id: 'c1' })).toBe('wheat')
    expect(thingKind(state, { kind: 'item', id: 'gone' })).toBeNull()
  })
})
