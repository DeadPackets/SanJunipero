import { z } from 'zod'
import type { LlmClient } from '@sj/llm'
import { NARRATOR_CANON } from '../canon.js'
import { FOOTNOTE_RULE, NARRATOR_VOCABULARY_NOTES, castLaw } from '../chronicle.js'
import { NARRATOR_VOICE, NARRATOR_VOICES, type NarratorVoice } from '../voice.js'
import type {
  CastMember,
  ChapterDigest,
  ChapterSummary,
  EraSummary,
  NarratorLlm,
  PublicRecord,
  SceneDigest,
} from '../types.js'

export const ChapterSummarySchema = z
  .object({
    title: z.string().min(1),
    text: z.string().min(1),
    citations: z.array(z.number().int().nonnegative()).max(40),
  })
  .strict()

export const EraSummarySchema = z
  .object({
    title: z.string().min(1),
    text: z.string().min(1),
    citations: z.array(z.number().int().nonnegative()).max(60),
  })
  .strict()

const NewspaperCopySchema = z
  .object({
    headline: z.string().min(1),
    body: z.string().min(1),
    citations: z.array(z.number().int().nonnegative()).max(40),
  })
  .strict()

const BiographySchema = z.object({ title: z.string().min(1), body: z.string().min(1) }).strict()

export type NarratorLlmClient = Pick<LlmClient, 'object' | 'text'>

const user = (content: string) => [{ role: 'user' as const, content }]

export function makeNarratorLlm(
  client: NarratorLlmClient,
  voice: NarratorVoice = NARRATOR_VOICE,
): NarratorLlm {
  const speak = NARRATOR_VOICES[voice]
  return {
    async summarizeChapter(
      scenes: SceneDigest[],
      cast: readonly CastMember[] = [],
    ): Promise<ChapterSummary> {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          `${NARRATOR_VOCABULARY_NOTES}\n` +
            `${castLaw(
              cast,
              scenes.some((s) => s.cast.length > 0),
            )}\n` +
            "Write this day's chapter of the chronicle from the scene digests below, and give it a title.\n" +
            `${speak.chapter}\n` +
            'Cite only ledger numbers listed; each citation is the number of an event you summarize.\n' +
            `${FOOTNOTE_RULE}\n` +
            JSON.stringify(scenes),
        ),
        schema: ChapterSummarySchema,
      })
      return value
    },
    async summarizeEra(chapters: ChapterDigest[]): Promise<EraSummary> {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          'Write the weekly arc of the chronicle from the day chapters below, and give it a title.\n' +
            `${speak.era}\n` +
            'Cite only ledger numbers listed; each citation is the number of an event you summarize.\n' +
            `${FOOTNOTE_RULE}\n` +
            JSON.stringify(chapters),
        ),
        schema: EraSummarySchema,
      })
      return value
    },
    async newspaperCopy(day: number, highlights: string[]) {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          `Write the town newspaper copy for day ${day} from the highlights below. ` +
            'A headline and a short body, as a village crier would tell it. ' +
            'Cite only ledger numbers listed.\n' +
            JSON.stringify(highlights),
        ),
        schema: NewspaperCopySchema,
      })
      return value
    },
    async biography(_agentId: string, name: string, record: PublicRecord[]) {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          `Write the life of ${name} from what the town saw, below. ` +
            'Only what was seen and heard in public is known; write nothing of their private mind.\n' +
            `${speak.biography}\n${FOOTNOTE_RULE}\n` +
            JSON.stringify(record),
        ),
        schema: BiographySchema,
      })
      return value
    },
  }
}
