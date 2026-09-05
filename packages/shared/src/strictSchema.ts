import { z } from 'zod'

type Node = Record<string, unknown>

/** Where a schema breaks OpenAI's strict decoder, which takes no oneOf, no optional key and no
 *  open object. Empty means it will be accepted as sent. */
export function strictSchemaFaults(schema: z.ZodType): string[] {
  const out: string[] = []
  walk(z.toJSONSchema(schema, { target: 'draft-7' }), 'root', out)
  return out
}

function walk(node: unknown, path: string, out: string[]): void {
  if (typeof node !== 'object' || node === null) return
  const n = node as Node
  if ('oneOf' in n) out.push(`${path}: oneOf`)
  if (n.type === 'object' || 'properties' in n) {
    const props = (n.properties ?? {}) as Node
    const required = new Set((n.required as string[] | undefined) ?? [])
    const optional = Object.keys(props).filter((k) => !required.has(k))
    if (optional.length > 0) out.push(`${path}: optional ${optional.join(', ')}`)
    if (n.additionalProperties !== false) out.push(`${path}: open object`)
    for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, out)
  }
  for (const key of ['items', 'anyOf', 'oneOf', 'allOf']) {
    const v = n[key]
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${path}.${key}[${i}]`, out)
      })
    } else if (v !== undefined) walk(v, `${path}.${key}`, out)
  }
}
