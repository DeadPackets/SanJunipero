// Renders one day per voice against a COPY of the narrator db. Never run in the pipeline; never
// opens the original narrator db for writing.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { FORBIDDEN_FRAMING, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { LlmClient, PROVIDER_ORDER } from '@sj/llm'
import { applyFootnotes, proseIdLeaks, sceneDigests } from '../src/chronicle.js'
import { scanPromptForGlassLeak } from '@sj/shared'
import { makeNarratorLlm } from '../src/llm/narratorLlm.js'
import { collectPublicRecord } from '../src/publications.js'
import { NarratorStore } from '../src/store.js'
import { NARRATOR_VOICES, type NarratorVoice } from '../src/voice.js'

const NARRATOR_DB = '/home/ubuntu/workspace/SanJunipero/rehearsals/minds/_narrator.db'
const WORLD_DB = '/home/ubuntu/workspace/SanJunipero/data/dev-world.db'
const OUT_DIR = process.env.VOICE_OUT ?? '/home/ubuntu/handoff/cleanup/stage7/voice'
const SCRATCH = process.env.VOICE_SCRATCH ?? '/tmp/voice-render'
const DAY = 0
const SUBJECT = { id: 'amara', name: 'Amara' }
const BUDGET_USD = 0.6
const LETTER: Record<NarratorVoice, string> = { chronicler: 'A', neighbour: 'B', almanac: 'C' }

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(SCRATCH, { recursive: true })
const copyPath = join(SCRATCH, 'narrator-copy.db')
copyFileSync(NARRATOR_DB, copyPath)

const db = new Database(copyPath)
const world = new Database(WORLD_DB, { readonly: true })

const scenes = new NarratorStore(db).scenesForDay(DAY)

const dayEvents = world
  .prepare('SELECT seq, type FROM events WHERE tick <= ?')
  .all((DAY + 1) * MINUTES_PER_DAY - 1) as Pick<SimEvent, 'seq' | 'type'>[]
const typeOf = new Map(dayEvents.map((e) => [e.seq, e.type]))
const typeCounts = (ids: number[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const id of ids) {
    const t = typeOf.get(id)
    if (t !== undefined) counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

const digests = sceneDigests(scenes, typeCounts)
const validChapter = new Set(scenes.flatMap((s) => s.eventIds))
const record = collectPublicRecord(world, SUBJECT.id, DAY)
const validBio = new Set(record.map((r) => r.eventSeq))

const scan = (label: string, text: string): string[] => {
  const flags: string[] = []
  const glass = scanPromptForGlassLeak(text)
  if (glass.length > 0) flags.push(`${label}: glass leak — ${glass.join(', ')}`)
  if (FORBIDDEN_FRAMING.test(text)) flags.push(`${label}: FORBIDDEN_FRAMING match`)
  const leaks = proseIdLeaks(text)
  if (leaks.length > 0) flags.push(`${label}: number in prose — ${leaks.slice(0, 6).join(' | ')}`)
  return flags
}

const spent = (): { usd: number; inTok: number; outTok: number } => {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd),0) usd, COALESCE(SUM(input_tokens),0) i,
              COALESCE(SUM(output_tokens),0) o FROM llm_calls WHERE caller = 'voice'`,
    )
    .get() as { usd: number; i: number; o: number }
  return { usd: r.usd, inTok: r.i, outTok: r.o }
}

const client = new LlmClient({
  db,
  caller: 'voice',
  providerOrder: PROVIDER_ORDER,
  budgetUsd: BUDGET_USD,
  expectedCallCostUsd: 0.05,
})

const rendered: string[] = []

// One voice at a time: the per-variant cost line is the difference of two `llm_calls` sums,
// which only reads true while nothing else is spending against the same caller.
for (const voice of Object.keys(NARRATOR_VOICES) as NarratorVoice[]) {
  const before = spent()
  const llm = makeNarratorLlm(client, voice)

  const summary = await llm.summarizeChapter(digests)
  const chapter = applyFootnotes(summary.text, summary.citations, validChapter)
  const bioRaw = await llm.biography(SUBJECT.id, SUBJECT.name, record)
  const bio = applyFootnotes(bioRaw.body, [], validBio)
  const caption = `Day ${DAY}: ${summary.title}`

  const after = spent()
  const cost = after.usd - before.usd
  const header =
    `cost $${cost.toFixed(4)} · in ${after.inTok - before.inTok} tok · out ${after.outTok - before.outTok} tok · ` +
    `2 calls · chapter ${chapter.text.length} chars, ${chapter.citations.length} citations (${chapter.dangling.length} dangling) · ` +
    `life ${bio.text.length} chars, ${bio.citations.length} citations (${bio.dangling.length} dangling)`

  const flags = [
    ...scan('chapter', `${summary.title}\n${chapter.text}`),
    ...scan('life', `${bioRaw.title}\n${bio.text}`),
    ...scan('caption', caption),
  ]

  const md = [
    `# ${LETTER[voice]} — the ${voice}`,
    `> ${header}`,
    `> glass scan: ${flags.length === 0 ? 'clean' : flags.join(' ; ')}`,
    '',
    '## Chapter',
    `### ${summary.title}`,
    '',
    chapter.text,
    '',
    `## Life — ${bioRaw.title}`,
    '',
    bio.text,
    '',
    '## Timelapse caption',
    '',
    caption,
    '',
  ].join('\n')

  writeFileSync(join(OUT_DIR, `${LETTER[voice]}.md`), md)
  rendered.push(md)
  console.log(`${LETTER[voice]} ${voice}: ${header}`)
  for (const f of flags) console.log(`  FLAG ${f}`)
}

const current = db.prepare('SELECT title, text FROM chapters WHERE day = ?').get(DAY) as {
  title: string
  text: string
}
const currentBio = db
  .prepare("SELECT title, body FROM publications WHERE kind = 'biography' AND day = ?")
  .get(DAY) as { title: string; body: string } | undefined

writeFileSync(
  join(OUT_DIR, 'README.md'),
  [
    '# The town in three voices — rehearsal 3, day 0',
    '',
    'Pick one. The switch is `NARRATOR_VOICE` in `packages/narrator/src/voice.ts`.',
    '',
    '## Now (what rehearsal 3 shipped)',
    `### ${current.title}`,
    '',
    current.text,
    '',
    ...(currentBio === undefined
      ? []
      : [`### Life — ${currentBio.title}`, '', currentBio.body, '']),
    ...rendered.flatMap((md) => [md, '']),
    '---',
    `Total for all three: $${spent().usd.toFixed(4)} of the $${BUDGET_USD.toFixed(2)} cap.`,
    '',
  ].join('\n'),
)

console.log(`\ntotal $${spent().usd.toFixed(4)} — ${OUT_DIR}/README.md`)
