import { MINUTES_PER_DAY, type ConstructKind, type QuotedName } from '@sj/shared'
import type { Milestone } from '../types.js'

// The construct registry lives in the arbiter's own db, which the chronicle cannot read: a
// milestone row is the one bridge, and the narrator never imports the arbiter.

export type RecognizedConstruct = {
  id: string
  type: ConstructKind
  nameProvenance: QuotedName | null
  participants: string[]
  firstTick: number
  recurrences: readonly { tick: number }[]
}

// What they do, never the id: a label carrying `festival` would be a glass leak.
const KIND_LABELS: Readonly<Record<ConstructKind, string>> = {
  festival: 'the first time they gathered to celebrate',
  faith: 'the first time they gathered over something they hold sacred',
  council: 'the first time they gathered to settle something',
  market: 'the first time they gathered to hand things over',
  custom: 'the first thing they took to doing over and over',
}

/** `seen` is the ledger's own kinds, so a kind is never milestoned twice. */
export function constructMilestones(
  constructs: readonly RecognizedConstruct[],
  seen: ReadonlySet<string>,
): Milestone[] {
  const out: Milestone[] = []
  const written = new Set(seen)
  const add = (row: Milestone): void => {
    if (written.has(row.kind)) return
    written.add(row.kind)
    out.push(row)
  }
  for (const c of constructs) {
    // The gathering that made it a pattern, which is the moment worth a line.
    const tick = c.recurrences.at(-1)?.tick ?? c.firstTick
    const base = {
      tier: 3 as const,
      domain: 'construct',
      day: Math.floor(tick / MINUTES_PER_DAY),
      tick,
      agentIds: c.participants,
      constructId: c.id,
    }
    add({ ...base, kind: `first_${c.type}`, label: KIND_LABELS[c.type], eventSeq: 0 })
    if (c.nameProvenance !== null)
      add({
        ...base,
        // The construct's id rides in the kind because `milestones.kind` is the only UNIQUE
        // the schema has, and one naming per gathering is what must not repeat.
        kind: `first_name_${c.id}`,
        label: `the day they had a word of their own for it: ${c.nameProvenance.name}`,
        eventSeq: c.nameProvenance.eventSeq,
        nameProvenance: c.nameProvenance,
      })
  }
  return out
}
