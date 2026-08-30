import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import {
  FOOTNOTE_PREFIX,
  FOOTNOTE_RULE,
  applyFootnotes,
  footnoteSeqs,
  proseIdLeaks,
  pruneFootnotes,
  renderChapter,
  stripFootnotes,
} from './chronicle.js'
import { makeNarratorLlm, type NarratorLlmClient } from './llm/narratorLlm.js'
import { scanPromptForGlassLeak } from '@sj/shared'
import { NARRATOR_VOICE, NARRATOR_VOICES, type NarratorVoice } from './voice.js'
import type { NarratorLlm, SceneSegment } from './types.js'

const VOICES = Object.keys(NARRATOR_VOICES) as NarratorVoice[]

const scenes: SceneSegment[] = [
  { day: 1, startTick: 1440, endTick: 1450, eventIds: [1, 2, 3], cast: ['omar'], location: '3,4' },
  { day: 1, startTick: 1500, endTick: 1510, eventIds: [4, 5], cast: ['nadia'], location: null },
]

// Written the way each voice is asked: no number in a sentence, one footnote line a paragraph.
const CLEAN: Record<NarratorVoice, string> = {
  chronicler:
    'Omar raised the wall by the storehouse and Nadia carried water to him twice.\nSeen: 1, 2\n\nBy evening the quarrel had gone quiet.\nSeen: 4, 5',
  neighbour:
    'We watched Omar set the last post. Nadia brought him water.\nSeen: 1, 3\n\nWe went in early. The lane was quiet.\nSeen: 5',
  almanac:
    'Clear, wind off the water. **Omar** raised the wall. **Nadia** carried water.\nSeen: 2, 3\n\nStill night. **Nadia** slept early.\nSeen: 4',
}

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const llmSaying = (text: string, citations: number[] = []): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({ title: 'The Wall', text, citations })),
  summarizeEra: vi.fn(),
  newspaperCopy: vi.fn(),
  biography: vi.fn(),
})

describe('footnote parsing', () => {
  it('reads every seq off the footnote lines and leaves the prose without them', () => {
    const text = CLEAN.chronicler
    expect(footnoteSeqs(text)).toEqual([1, 2, 4, 5])
    expect(stripFootnotes(text)).not.toContain(FOOTNOTE_PREFIX)
    expect(stripFootnotes(text)).toContain('Omar raised the wall')
  })

  it('reads digits only where the label claims them', () => {
    expect(footnoteSeqs('The eleven frames stood, all seven of them.')).toEqual([])
    expect(footnoteSeqs('The eleven frames stood.\nSeen: 7')).toEqual([7])
  })

  // Asked for a trailing line, the narrator as often hangs the footnote off a sentence instead.
  it('reads a footnote wherever the narrator put it', () => {
    const tail = 'She walked without hurry.  Seen: 285, 286, 12126'
    expect(footnoteSeqs(tail)).toEqual([285, 286, 12126])
    expect(stripFootnotes(tail)).toBe('She walked without hurry.')
    const mid = 'Fair at first light. Seen: 1, 17. They gathered at the fork. Seen: 2, 3.'
    expect(footnoteSeqs(mid)).toEqual([1, 17, 2, 3])
    expect(stripFootnotes(mid)).toBe('Fair at first light. They gathered at the fork.')
  })

  it('takes a range as no citation at all', () => {
    const ranged = 'The ground took the shape of a town.     Seen: 1-6009, 6010-11647'
    expect(footnoteSeqs(ranged)).toEqual([])
    expect(stripFootnotes(ranged)).toBe('The ground took the shape of a town.')
    expect(pruneFootnotes(ranged, new Set([1, 6010]))).toBe('The ground took the shape of a town.')
  })

  it('prunes an invented seq out of the line and drops a line left empty', () => {
    expect(pruneFootnotes('A day.\nSeen: 1, 99, 3\n', new Set([1, 3]))).toContain('Seen: 1, 3')
    expect(pruneFootnotes('A day.\nSeen: 99\n', new Set([1]))).not.toContain('Seen')
  })
})

describe('applyFootnotes', () => {
  it('passes real seqs through untouched', () => {
    const out = applyFootnotes(CLEAN.chronicler, [1], new Set([1, 2, 3, 4, 5]))
    expect(out.dangling).toEqual([])
    expect(out.citations).toEqual([1, 2, 4, 5])
    expect(out.text).toBe(CLEAN.chronicler)
  })

  it('fails an invented seq: reported dangling, dropped from the citations and from the line', () => {
    const out = applyFootnotes('A day.\nSeen: 1, 99', [], new Set([1, 2, 3]))
    expect(out.dangling).toEqual([99])
    expect(out.citations).toEqual([1])
    expect(out.text).not.toContain('99')
  })

  it('renderChapter persists the footnoted seqs and alerts on the invented one', async () => {
    const store = memStore()
    const alert = vi.fn()
    const chapter = await renderChapter({
      store,
      llm: llmSaying('A day.\nSeen: 1, 4, 99'),
      day: 1,
      scenes,
      alert,
    })
    expect(chapter.citations).toEqual([1, 4])
    expect(chapter.text).not.toContain('99')
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toContain('99')
  })
})

describe.each(VOICES)('the %s voice', (voice) => {
  it('leaves no tick or event number in the prose', async () => {
    const store = memStore()
    const chapter = await renderChapter({
      store,
      llm: llmSaying(CLEAN[voice]),
      day: 1,
      scenes,
    })
    expect(proseIdLeaks(chapter.text)).toEqual([])
  })

  it('its instructions are diegetic and leak nothing through the glass', () => {
    const all = Object.values(NARRATOR_VOICES[voice]).join(' ')
    expect(FORBIDDEN_FRAMING.test(all)).toBe(false)
    expect(scanPromptForGlassLeak(all)).toEqual([])
  })

  it('reaches the chapter and the life prompts, and the life is sent no ticks', async () => {
    const sent: string[] = []
    const client = {
      async object(opts: { messages: { content: string }[] }) {
        sent.push(opts.messages.at(-1)!.content)
        return { value: { title: 't', text: 'x', citations: [], body: 'b' } }
      },
    } as unknown as NarratorLlmClient
    const llm = makeNarratorLlm(client, voice)
    await llm.summarizeChapter([{ eventIds: [1], cast: ['omar'], location: null, typeCounts: {} }])
    await llm.biography('omar', 'Omar', [
      { eventSeq: 4, day: 0, text: 'was seen about the settlement' },
    ])
    expect(sent[0]).toContain(NARRATOR_VOICES[voice].chapter)
    expect(sent[1]).toContain(NARRATOR_VOICES[voice].biography)
    expect(sent[1]).toContain('"eventSeq":4')
    expect(sent[1]).not.toContain('"tick"')
    for (const s of sent) expect(s).toContain(FOOTNOTE_PREFIX)
  })
})

describe('the leak scan is load-bearing', () => {
  it('catches every shape the old chronicle wrote a number in', () => {
    expect(proseIdLeaks('a turning in the weather [30034], and the names came')).not.toEqual([])
    expect(proseIdLeaks('At tick 8, Amara was seen to enter')).not.toEqual([])
    expect(proseIdLeaks('Amara was seen to sleep (3542–3543), then to rise')).not.toEqual([])
    expect(proseIdLeaks('Later that day Amara rose (event 285)')).not.toEqual([])
  })

  // A misspelled label is the one way unchecked seqs reach the page; the bare list is the tell.
  it('catches a run of numbers no footnote label claimed', () => {
    expect(proseIdLeaks('The work was done.  Seun: 1, 118, 5972')).not.toEqual([])
  })

  it('leaves ordinary counting alone', () => {
    expect(proseIdLeaks('Eleven frames were raised, and 3 of them by Omar.')).toEqual([])
  })
})

describe('FOOTNOTE_RULE', () => {
  // The first live run copied the example numbers straight into three chapters.
  it('carries no digits for the narrator to copy', () => {
    expect(FOOTNOTE_RULE).toContain(FOOTNOTE_PREFIX)
    expect(FOOTNOTE_RULE).not.toMatch(/\d/)
  })
})

describe('NARRATOR_VOICE', () => {
  it('is one of the three, and is what makeNarratorLlm uses unasked', async () => {
    expect(VOICES).toContain(NARRATOR_VOICE)
    const sent: string[] = []
    const client = {
      async object(opts: { messages: { content: string }[] }) {
        sent.push(opts.messages.at(-1)!.content)
        return { value: { title: 't', text: 'x', citations: [] } }
      },
    } as unknown as NarratorLlmClient
    await makeNarratorLlm(client).summarizeChapter([
      { eventIds: [1], cast: [], location: null, typeCounts: {} },
    ])
    expect(sent[0]).toContain(NARRATOR_VOICES[NARRATOR_VOICE].chapter)
  })
})
