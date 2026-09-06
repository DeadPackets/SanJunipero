// SPENDS REAL MONEY (about a cent): eight lines between founder pairs through the real scene
// prompt, printed with their moves, so a change to how the minds talk can be read before a
// rehearsal. `node --env-file=.env --import tsx packages/agents/scripts/speech-bake.ts [lines]`
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmClient, migrateLlmTables } from '@sj/llm'
import { openAgentDb } from '../src/memory/schema.js'
import { FOUNDER_MINDS } from '../src/live/founderMinds.js'
import { appendLine, openScene, threadFor, type Scene } from '../src/scene/scene.js'
import { makeSceneLlm, type SceneVoice } from '../src/scene/sceneLlm.js'

const LINES = Number(process.argv[2] ?? 8)
const DATA_DIR = fileURLToPath(new URL('../data/speech-bake/', import.meta.url))
const PAIRS: [string, string, string][] = [
  ['bashir', 'farida', "Farida, the net's torn again. Third time this month."],
  ['nadia', 'omar', 'Omar, you look terrible. Did you sleep at all?'],
  ['tariq', 'halim', "Halim. You're up early."],
  ['salma', 'dilara', "Dilara. Your dad's looking for you."],
]

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('no key in the environment')
  mkdirSync(DATA_DIR, { recursive: true })
  const dbPath = path.join(DATA_DIR, 'bake.db')
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  const db = openAgentDb(dbPath)
  migrateLlmTables(db)
  const living = FOUNDER_MINDS.map((m) => ({ id: m.id, name: m.identity.name }))
  const voiceOf = (id: string): SceneVoice => {
    const spec = FOUNDER_MINDS.find((m) => m.id === id)!
    return {
      identity: spec.identity,
      personality: () => ({ doc: spec.personality, autobiography: [] }),
      livingCast: () => living,
    }
  }
  const nameOf = (id: string): string => living.find((p) => p.id === id)?.name ?? id
  let spent = 0
  for (const [a, b, opener] of PAIRS) {
    const llm = {
      [a]: makeSceneLlm(
        new LlmClient({ db, caller: 'scene', agentId: a, budgetUsd: 0.2 }),
        voiceOf(a),
      ),
      [b]: makeSceneLlm(
        new LlmClient({ db, caller: 'scene', agentId: b, budgetUsd: 0.2 }),
        voiceOf(b),
      ),
    }
    const recent: Record<string, string[]> = { [a]: [], [b]: [] }
    let tick = 9 * 60
    const scene: Scene = openScene({
      openedTick: tick,
      participants: [a, b],
      audience: [],
      opener: a,
      topic: opener,
      stakes: 5,
    })
    appendLine(scene, { agentId: a, text: opener, aside: '', move: 'none', tick })
    console.log(`\n=== ${nameOf(a)} & ${nameOf(b)}`)
    console.log(`${nameOf(a).padEnd(7)} [open]   ${opener}`)
    let speaker = b
    for (let i = 0; i < LINES; i++) {
      tick += 3
      const cast = [a, b].map((id) => ({ id, name: nameOf(id) }))
      const turn = await llm[speaker]!.line({
        scene,
        agentId: speaker,
        cast,
        audience: [],
        ties: [],
        thread: threadFor(scene, speaker),
        recent: recent[speaker]!,
        wrapUp: i >= LINES - 2,
        tick,
        energy: 80,
        mood: '',
      })
      if (turn.speech === null || turn.speech.trim() === '') {
        console.log(
          `${nameOf(speaker).padEnd(7)} [silent]${turn.leave ? ' leaves' : ''}  (${turn.thought})`,
        )
        break
      }
      appendLine(scene, {
        agentId: speaker,
        text: turn.speech,
        aside: turn.thought,
        move: turn.move,
        tick,
      })
      recent[speaker]!.push(turn.speech)
      console.log(
        `${nameOf(speaker).padEnd(7)} [${turn.move}]${' '.repeat(Math.max(1, 9 - turn.move.length))}${turn.speech}`,
      )
      if (turn.leave) {
        console.log(`        (${nameOf(speaker)} leaves)`)
        break
      }
      speaker = speaker === a ? b : a
    }
  }
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS n FROM llm_calls')
    .get() as { usd: number; n: number }
  spent = row.usd
  console.log(`\n${row.n} calls, $${spent.toFixed(4)}`)
  db.close()
}
void main()
