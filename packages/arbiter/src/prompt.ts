import type { LlmMessage } from '@sj/agents'

export type AdjudicationBlocks = {
  canon: string // CANON + "The town currently knows: " + codex known list (prose)
  agent: {
    name: string
    skills: Record<string, number>
    inventory: Array<{ kind: string; qty: number }>
    position: { x: number; y: number }
  }
  precedent: Array<{ summary: string; verdictKind: string; recipeName?: string }>
  intent: string
}

export type AssembledAdjudicationPrompt = {
  system: string
  messages: LlmMessage[]
  estTokens: number
}

// Operator-facing instruction appended after the canon block. The canon +
// instruction prefix is byte-stable across every adjudication, so the
// provider's prefix cache stays warm.
const ADJUDICATION_INSTRUCTION = `You are the physics arbiter of San Junipero. An agent proposes an action. Reply with one verdict:
"map" only if the town already performs this exact action as a routine;
"attempt" if the action is new but the agent can physically try it with the town's fire, clay pots, wood, fiber, stone implements, and river — whether it succeeds is decided later, never by you;
"impossible" only if the action cannot even be started because it needs something the town wholly lacks.`

// The human-framing law for arbiter outputs: no world text, recipe name,
// verdict reason, or outcome label may name the machinery behind the agent.
export const FORBIDDEN_FRAMING =
  /\b(AI|A\.I\.|artificial intelligence|language models?|LLMs?|neural|prompts?|context windows?|tokens?|chatbots?|simulations?|models?|tools?)(?!\w)/i

function renderAgent(agent: AdjudicationBlocks['agent']): string {
  const skills = Object.entries(agent.skills)
    .map(([track, level]) => `  ${track}: ${level}`)
    .join('\n')
  const inventory = agent.inventory.map((item) => `  ${item.qty} ${item.kind}`).join('\n')
  return [
    `Agent: ${agent.name}`,
    'Skills:',
    skills,
    'Inventory:',
    inventory,
    `Position: ${agent.position.x}, ${agent.position.y}`,
  ].join('\n')
}

function renderPrecedent(precedent: AdjudicationBlocks['precedent']): string {
  const rows = precedent.map((p) => {
    const recipe = p.recipeName ? ` (${p.recipeName})` : ''
    return `  [${p.verdictKind}] ${p.summary}${recipe}`
  })
  return rows.length > 0 ? ['Precedent:', ...rows].join('\n') : ''
}

function renderUser(blocks: AdjudicationBlocks): string {
  const parts = [renderAgent(blocks.agent)]
  const precedent = renderPrecedent(blocks.precedent)
  if (precedent) parts.push(precedent)
  parts.push(`Intent: ${blocks.intent}`)
  return parts.join('\n\n')
}

function estTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function assembleAdjudicationPrompt(
  blocks: AdjudicationBlocks,
): AssembledAdjudicationPrompt {
  const system = `${blocks.canon}\n\n${ADJUDICATION_INSTRUCTION}`
  const user = renderUser(blocks)
  const messages: LlmMessage[] = [{ role: 'user', content: user }]
  return { system, messages, estTokens: estTokens(`${system}${user}`) }
}
