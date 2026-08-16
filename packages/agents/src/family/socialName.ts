import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { LlmClient } from '../llm/client.js'
import type { ParentPersona } from './derivePersona.js'
import type { AgentBornPayload } from './watchBirths.js'

// Ops-side only. The registry name is world state and hashes; what the mother
// calls the child is a record of a mind's answer and never touches the fold.
export function migrateFamilyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      social_name TEXT NOT NULL,
      named_by TEXT NOT NULL,
      tick INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_social_names_agent ON social_names(agent_id);
  `)
}

export const MAX_SOCIAL_NAME_CHARS = 40

const SocialNameAnswer = z.object({ name: z.string() }).strict()

export function promptBirthLine(born: AgentBornPayload): string {
  const [child, object] = born.sex === 'f' ? ['daughter', 'her'] : ['son', 'him']
  return `You have borne a ${child}. The town rolls will know ${object} as ${born.name} — what do you call ${object}?`
}

function namingPrompt(born: AgentBornPayload, mother: ParentPersona): { system: string; user: string } {
  const v = mother.identity.voiceCard
  return {
    system: [
      'You have just given birth, and the child is here.',
      'Answer with the one name you will use for this child from now on, and nothing else.',
      'It may be the name the town rolls carry, or it may be your own — a name out of your family, a word for what you see in the face, whatever you would actually say.',
      `You speak ${v.register}.`,
    ].join('\n'),
    user: [promptBirthLine(born), `You are ${mother.identity.name}. Right now you are ${mother.personality.current.mood}.`].join('\n'),
  }
}

// Never throws and never costs the town a birth: a mother who is dead, silent,
// or past her budget simply leaves the name unset. The town will settle on
// something eventually, or it will not.
export async function captureSocialName(
  llm: LlmClient,
  db: Database.Database,
  ctx: { born: AgentBornPayload; motherPersona: ParentPersona | null; tick: number },
): Promise<string | null> {
  if (ctx.motherPersona === null) return null
  const p = namingPrompt(ctx.born, ctx.motherPersona)
  let answer: string
  try {
    const { value } = await llm.object({
      system: p.system,
      messages: [{ role: 'user', content: p.user }],
      schema: SocialNameAnswer,
    })
    answer = value.name.trim()
  } catch {
    return null
  }
  if (answer.length === 0 || answer.length > MAX_SOCIAL_NAME_CHARS) return null
  db.prepare('INSERT INTO social_names (agent_id, social_name, named_by, tick) VALUES (?, ?, ?, ?)').run(
    ctx.born.id,
    answer,
    ctx.born.motherId,
    ctx.tick,
  )
  return answer
}
