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

// R4: a viewer is never shown an id. Where the world has no name for somebody — a mind the
// snapshot has dropped, or the genesis runner, who is nobody — the town says so instead.
export const SOMEONE = 'someone'

export const personWords = (name: string | undefined): string => name ?? SOMEONE

export type NameIndex = Readonly<Record<string, { name: string } | undefined>>

/** The one way to turn an agent id into words. An id goes in and prose comes out, so no caller
 *  is left holding the id — which is how `?? id` stopped being a thing anyone could type. */
export const agentName = (index: NameIndex | null | undefined, id: string): string =>
  personWords(index?.[id]?.name)
