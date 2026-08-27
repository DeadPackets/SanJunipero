export type NameSource = {
  sourceKind: 'speech' | 'inscription'
  text: string
  eventSeq: number
  byId: string
}
export type QuotedName = {
  name: string
  sourceKind: NameSource['sourceKind']
  eventSeq: number
  quote: string
  byId: string
}

// The naming law: a name is a thing somebody said or carved, kept verbatim with the words it
// came out of. No match, no name — the row keeps `null` and the viewer is told so.
export function assertQuotedName(name: string, sources: readonly NameSource[]): QuotedName | null {
  for (const s of sources) {
    if (!s.text.includes(name)) continue
    return { name, sourceKind: s.sourceKind, eventSeq: s.eventSeq, quote: s.text, byId: s.byId }
  }
  return null
}
