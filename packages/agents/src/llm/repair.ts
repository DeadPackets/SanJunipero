import type { z } from 'zod'

// May remove framing and re-read the provider's own characters; it may never add a field, a
// value or a meaning, and a payload that needs guessing stays a failure.

export type RepairCandidate = { value: unknown; how: string }

const FENCE = /```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/

const jsonOrNothing = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

// Every balanced object or array at depth zero, found with a string-aware walk so a brace
// inside a quoted sentence is never mistaken for structure.
export function balancedSpans(text: string): string[] {
  const spans: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}' || ch === ']') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start !== -1) {
        spans.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return spans
}

// A comma before a closing brace is a habit, not a meaning. Dropped only outside a string, so
// a sentence that happens to read `bad, }` keeps every character the provider wrote.
export function dropTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j += 1
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += ch
  }
  return out
}

// The reframings, cheapest first. Nothing here looks at a schema.
export function repairCandidates(text: string): RepairCandidate[] {
  const out: RepairCandidate[] = []
  const seen = new Set<string>()
  const consider = (how: string, source: string | undefined): void => {
    if (source === undefined || source.length === 0 || seen.has(`${how}:${source}`)) return
    seen.add(`${how}:${source}`)
    const direct = jsonOrNothing(source)
    if (direct === undefined) {
      const stripped = dropTrailingCommas(source)
      if (stripped !== source) consider(`${how}+trailing-commas`, stripped)
      return
    }
    out.push({ value: direct, how })
    // An answer the provider quoted whole is the right object one wrapping too deep.
    if (typeof direct === 'string') {
      const inner = jsonOrNothing(direct.trim())
      if (inner !== undefined) out.push({ value: inner, how: `${how}+unquoted` })
    }
  }
  consider('as-written', text.trim())
  consider('fenced', FENCE.exec(text)?.[1]?.trim())
  for (const span of balancedSpans(text)) consider('braced', span)
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Walk a path and hand back the container holding its last segment, so a fix can be applied
// where the schema said the fault was.
function containerAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (Array.isArray(cur) && typeof key === 'number') cur = cur[key]
    else if (isRecord(cur)) cur = cur[String(key)]
    else return undefined
  }
  return cur
}

// A number the provider quoted. Lossless only: `"4"` is the number four written as text,
// `"4 events"` is a sentence and stays a failure.
const quotedNumber = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  if (trimmed.length === 0) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && String(n) === trimmed ? n : undefined
}

// The two repairs the schema asks for by name, applied to a fixpoint: an unmodelled key is
// dropped and a quoted number is read as the number it spells. Nothing is supplied.
function applySchemaIssues<T>(
  value: unknown,
  schema: z.ZodType<T>,
): { value: T; how: string } | undefined {
  const current = structuredClone(value)
  const applied: string[] = []
  for (let round = 0; round < 4; round += 1) {
    const parsed = schema.safeParse(current)
    if (parsed.success) {
      return applied.length === 0 ? undefined : { value: parsed.data, how: applied.join('+') }
    }
    let changed = false
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const holder = containerAt(current, issue.path)
        if (!isRecord(holder)) continue
        for (const key of issue.keys)
          if (key in holder) {
            delete holder[key]
            changed = true
          }
        if (changed && !applied.includes('unknown-keys-dropped'))
          applied.push('unknown-keys-dropped')
      } else if (issue.code === 'invalid_type' && issue.expected === 'number') {
        const key = issue.path[issue.path.length - 1]
        const holder = containerAt(current, issue.path.slice(0, -1))
        if (key === undefined) continue
        const n = quotedNumber(
          Array.isArray(holder) && typeof key === 'number'
            ? holder[key]
            : isRecord(holder)
              ? holder[String(key)]
              : undefined,
        )
        if (n === undefined) continue
        if (Array.isArray(holder) && typeof key === 'number') holder[key] = n
        else if (isRecord(holder)) holder[String(key)] = n
        changed = true
        if (!applied.includes('quoted-numbers-read')) applied.push('quoted-numbers-read')
      }
    }
    if (!changed) return undefined
  }
  return undefined
}

// The whole pass: reframe, then let the schema name what is left. Returns the repaired value
// and the name of the repair that worked, or nothing at all.
export function repairToSchema<T>(
  text: string,
  schema: z.ZodType<T>,
): { value: T; how: string } | undefined {
  const candidates = repairCandidates(text)
  for (const { value, how } of candidates) {
    const parsed = schema.safeParse(value)
    if (parsed.success) return { value: parsed.data, how }
  }
  for (const { value, how } of candidates) {
    const fixed = applySchemaIssues(value, schema)
    if (fixed !== undefined) return { value: fixed.value, how: `${how}+${fixed.how}` }
  }
  return undefined
}
