import { describe, expect, it, vi } from 'vitest'
import { castLaw, namesOutsideRoll, renderChapter, withoutStrangers } from './chronicle.js'
import { makeNarratorLlm } from './llm/narratorLlm.js'
import { openNarratorDb } from './schema.js'
import { NarratorStore } from './store.js'
import type { CastMember, NarratorLlm, SceneSegment } from './types.js'

// The town as the live world held it on day 5: everyone dead, their graves standing.
const ROLL: CastMember[] = [
  { name: 'Yusuf', alive: false },
  { name: 'Amara', alive: false },
  { name: 'Nadia', alive: false },
  { name: 'Omar', alive: false },
  { name: 'Salma', alive: false },
]

// Verbatim from the live chronicle: ten villagers who have never existed, and "no bad turn came
// to any household" written over five graves.
const HALLUCINATED =
  'In the days of the gentle sun, Marah pressed the last of the apples into cider, Kepler mended ' +
  'a fencepost along the south bywater, and Ana cleared the lane of drifted stones. Tomas stood ' +
  'the whole afternoon at the ford, while Selden carried buckets from the spring. Elias ' +
  'discovered a wild fold of bees, and Netta sat with her mother through a bad turn. Yara ' +
  'gathered kindling at the edge of the meadow, and Harlow cut back the brambles. Corin walked ' +
  'it barefoot and found it firm.'

const GROUNDED =
  'The lanes stood empty. Rain came off the east fork and went again, and the graves of Yusuf ' +
  'and Amara took it without complaint. Nothing moved but the deer at the treeline.'

// `openNarratorDb` is what production opens, and it is what carries the alerts table.
const watched = (): { store: NarratorStore; alerts: () => { kind: string; detail: string }[] } => {
  const db = openNarratorDb(':memory:')
  return {
    store: new NarratorStore(db),
    alerts: () =>
      db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
        kind: string
        detail: string
      }[],
  }
}

// A day of weather and deer and nothing else — the shape that made the narrator invent a village.
const EMPTY_DAY: SceneSegment[] = [
  { day: 5, startTick: 7200, endTick: 7300, eventIds: [1, 2], cast: [], location: null },
]

const llmSaying = (text: string): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({ title: 'A Still Day', text, citations: [1] })),
  summarizeEra: vi.fn(),
  newspaperCopy: vi.fn(),
  biography: vi.fn(),
})

describe('the chronicle may name nobody the world has not got', () => {
  it('the check is built from the roll, and catches the village that was invented', () => {
    // Six of the ten. Corin, Elias and Yara open their sentences, where a capital is grammar
    // and no rule can tell a name from a first word — six is already a failed chapter.
    expect(namesOutsideRoll(HALLUCINATED, ROLL)).toEqual([
      'Ana',
      'Harlow',
      'Kepler',
      'Marah',
      'Netta',
      'Selden',
    ])
    expect(namesOutsideRoll(GROUNDED, ROLL)).toEqual([])
  })

  it('a chapter for a day of weather and deer names no one off the roll', async () => {
    const chapter = await renderChapter({
      store: watched().store,
      llm: llmSaying(GROUNDED),
      day: 5,
      scenes: EMPTY_DAY,
      cast: ROLL,
    })
    expect(namesOutsideRoll(chapter.text, ROLL)).toEqual([])
  })

  it('the prompt carries the roll, the law, and the stillness of a day nobody lived', async () => {
    const seen: string[] = []
    const client = {
      object: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
        seen.push(messages[0]!.content)
        return { value: { title: 'A Still Day', text: GROUNDED, citations: [1] } }
      }),
      text: vi.fn(),
    }
    await makeNarratorLlm(client as never).summarizeChapter(
      [{ eventIds: [1], cast: [], location: null, typeCounts: { fauna_moved: 4 } }],
      ROLL,
    )
    const prompt = seen[0]!
    for (const who of ROLL) expect(prompt).toContain(who.name)
    expect(prompt).toContain('No one is left alive in this town.')
    expect(prompt).toContain('A name not on this roll is a lie in the record.')
    expect(prompt).toContain('No person acted today')
  })

  it('drops the sentence that names a stranger, and says so in an alert', () => {
    const { store, alerts } = watched()
    const alert = vi.fn()
    const kept = withoutStrangers({ store, alert }, 'chapter for day 5', HALLUCINATED, ROLL)
    expect(namesOutsideRoll(kept, ROLL)).toEqual([])
    expect(kept.length).toBeLessThan(HALLUCINATED.length)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0]!.kind).toBe('cast_leak')
    expect(alerts()[0]!.detail).toContain('Marah')
  })

  it('leaves a grounded chapter untouched and costs nothing when the roll is unknown', () => {
    const { store } = watched()
    expect(withoutStrangers({ store }, 'day 5', GROUNDED, ROLL)).toBe(GROUNDED)
    expect(withoutStrangers({ store }, 'day 5', HALLUCINATED, [])).toBe(HALLUCINATED)
  })

  it('says nothing it does not know, and drops the stillness once somebody acts', () => {
    expect(castLaw([], true)).toBe('')
    expect(castLaw(ROLL, true)).not.toContain('No person acted today')
    expect(castLaw([{ name: 'Yusuf', alive: true }], true)).toContain(
      'Living, and the only people who can act: Yusuf.',
    )
  })
})
