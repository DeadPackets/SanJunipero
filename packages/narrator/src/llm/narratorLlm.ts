import { z } from 'zod'
import type { LlmClient } from '@sj/llm'
import { NARRATOR_CANON } from '../canon.js'
import { NARRATOR_VOCABULARY_NOTES } from '../chronicle.js'
import type {
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

export function makeNarratorLlm(client: NarratorLlmClient): NarratorLlm {
  return {
    async summarizeChapter(scenes: SceneDigest[]): Promise<ChapterSummary> {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          `${NARRATOR_VOCABULARY_NOTES}\n` +
            "Write this day's chapter of the chronicle from the scene digests below. " +
            'Give it a title and a short narrative. ' +
            'Cite only ledger numbers listed; each citation is the number of an event you summarize.\n' +
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
          'Write the weekly arc of the chronicle from the day chapters below. ' +
            'Give the era a title and a short narrative of how the week turned. ' +
            'Cite only ledger numbers listed; each citation is the number of an event you summarize.\n' +
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
    async biography(agentId: string, name: string, record: PublicRecord[]) {
      const { value } = await client.object({
        system: NARRATOR_CANON,
        messages: user(
          `Write a short biography of ${name} (known in the ledger as ${agentId}) ` +
            'from the public record below. Only what was seen and heard in public is known; ' +
            'write nothing of their private mind.\n' +
            JSON.stringify(record),
        ),
        schema: BiographySchema,
      })
      return value
    },
  }
}
