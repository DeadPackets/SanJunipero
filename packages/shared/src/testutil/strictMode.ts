/** What a strict Structured Outputs decoder demands of every object it is handed. The live 400
 *  named the first two by hand: "'required' ... including every key in properties. Missing 'x'". */
export function strictModeFaults(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => strictModeFaults(n, `${path}[${i}]`))
  if (node === null || typeof node !== 'object') return []
  const o = node as Record<string, unknown>
  const faults: string[] = []
  if (o.properties !== undefined) {
    const required = Array.isArray(o.required) ? (o.required as string[]) : []
    for (const key of Object.keys(o.properties as object)) {
      if (!required.includes(key)) faults.push(`${path}: ${key} is optional`)
    }
    if (o.additionalProperties !== false) faults.push(`${path}: additionalProperties is not false`)
  }
  for (const keyword of ['propertyNames', 'default']) {
    if (keyword in o) faults.push(`${path}: ${keyword}`)
  }
  return [...faults, ...Object.entries(o).flatMap(([k, v]) => strictModeFaults(v, `${path}.${k}`))]
}
