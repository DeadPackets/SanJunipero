import { describe, expect, it } from 'vitest'
import type { LlmUsage } from '@sj/llm'
import type { ChapterDigest, PublicRecord, SceneDigest } from '../types.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import {
  ChapterSummarySchema,
  EraSummarySchema,
  makeNarratorLlm,
  type NarratorLlmClient,
} from './narratorLlm.js'

const usage: LlmUsage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, costUsd: 0.0001 }

type Captured = { system: string; messages: { role: string; content: string }[] }

const scripted = (value: unknown, captured: Captured[] = []): NarratorLlmClient =>
  ({
    async object(opts: { system: string; messages: { role: string; content: string }[] }) {
      captured.push({ system: opts.system, messages: opts.messages })
      return { value, usage }
    },
    async text(opts: { system?: string; messages: { role: string; content: string }[] }) {
      captured.push({ system: opts.system ?? '', messages: opts.messages })
      return { text: 'scripted text', usage }
    },
  }) as unknown as NarratorLlmClient

const digests: SceneDigest[] = [
  {
    eventIds: [3, 7, 11],
    cast: ['omar', 'yusuf'],
    location: '3,4',
    typeCounts: { agent_spoke: 2, agent_injured: 1 },
  },
  { eventIds: [15, 21], cast: ['nadia'], location: null, typeCounts: { crop_harvested: 2 } },
]

const chapterDigests: ChapterDigest[] = [
  { day: 0, title: 'The First Morning', text: 'They woke by the river.', citations: [1] },
  { day: 1, title: 'The Argument', text: 'Omar and Yusuf quarrelled.', citations: [3, 7] },
]

const record: PublicRecord[] = [
  { eventSeq: 4, day: 0, text: 'was heard to say: "the river turns"' },
]

describe('makeNarratorLlm', () => {
  it('summarizeChapter sends every eventId and the citation instruction, returns the scripted summary', async () => {
    const captured: Captured[] = []
    const canned = {
      title: 'The Argument by the Storehouse',
      text: 'Omar and Yusuf came to blows.',
      citations: [3, 7],
    }
    const llm = makeNarratorLlm(scripted(canned, captured))
    const out = await llm.summarizeChapter(digests)
    expect(out).toEqual(canned)
    const last = captured[0]!.messages.at(-1)!
    expect(last.role).toBe('user')
    for (const id of [3, 7, 11, 15, 21]) expect(last.content).toContain(String(id))
    expect(last.content.toLowerCase()).toContain('cite only ledger numbers listed')
  })

  it('summarizeEra returns the scripted era object', async () => {
    const canned = {
      title: 'The Week of the Quarrel',
      text: 'Seven days passed.',
      citations: [1, 3],
    }
    const llm = makeNarratorLlm(scripted(canned))
    expect(await llm.summarizeEra(chapterDigests)).toEqual(canned)
  })

  it('newspaperCopy and biography return their scripted shapes', async () => {
    const news = {
      headline: 'Quarrel at the Storehouse',
      body: 'Blows were exchanged.',
      citations: [3],
    }
    expect(await makeNarratorLlm(scripted(news)).newspaperCopy(1, ['Omar struck Yusuf'])).toEqual(
      news,
    )
    const bio = { title: 'Omar of the Riverbend', body: 'A quarrelsome builder.' }
    expect(await makeNarratorLlm(scripted(bio)).biography('omar', 'Omar', record)).toEqual(bio)
  })

  it('FORBIDDEN_FRAMING is load-bearing: catches framing words, passes clean prose', () => {
    expect(FORBIDDEN_FRAMING.test('language model')).toBe(true)
    expect(FORBIDDEN_FRAMING.test('an AI wrote this')).toBe(true)
    expect(FORBIDDEN_FRAMING.test('the prompt said so')).toBe(true)
    expect(FORBIDDEN_FRAMING.test('this is a simulation')).toBe(true)
    expect(FORBIDDEN_FRAMING.test('Omar and Yusuf came to blows by the storehouse.')).toBe(false)
    // a scripted chapter containing framing still parses here — policing happens at render (Task 9+)
    const dirty = { title: 'x', text: 'written by a language model', citations: [] }
    expect(ChapterSummarySchema.parse(dirty)).toEqual(dirty)
  })

  it('every rendered system + user string is diegetic (no FORBIDDEN_FRAMING match)', async () => {
    const captured: Captured[] = []
    const client = scripted({ title: 't', text: 'x', citations: [] }, captured)
    const llm = makeNarratorLlm(client)
    await llm.summarizeChapter(digests)
    await llm.summarizeEra(chapterDigests)
    await llm.newspaperCopy(1, ['Omar struck Yusuf'])
    await llm.biography('omar', 'Omar', record)
    expect(captured.length).toBe(4)
    for (const call of captured) {
      expect(FORBIDDEN_FRAMING.test(call.system)).toBe(false)
      for (const m of call.messages) expect(FORBIDDEN_FRAMING.test(m.content)).toBe(false)
    }
  })

  it('schemas are strict with citation caps 40/60', () => {
    expect(() =>
      ChapterSummarySchema.parse({ title: 't', text: 'x', citations: [], extra: 1 }),
    ).toThrow()
    expect(() =>
      EraSummarySchema.parse({ title: 't', text: 'x', citations: [], extra: 1 }),
    ).toThrow()
    expect(() =>
      ChapterSummarySchema.parse({
        title: 't',
        text: 'x',
        citations: Array.from({ length: 41 }, (_, i) => i),
      }),
    ).toThrow()
    expect(() =>
      EraSummarySchema.parse({
        title: 't',
        text: 'x',
        citations: Array.from({ length: 61 }, (_, i) => i),
      }),
    ).toThrow()
    expect(
      EraSummarySchema.parse({
        title: 't',
        text: 'x',
        citations: Array.from({ length: 60 }, (_, i) => i),
      }).citations.length,
    ).toBe(60)
  })
})
