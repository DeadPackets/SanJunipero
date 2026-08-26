import { createHash } from 'node:crypto'

export function stableStringify(value: unknown): string {
  if (typeof value === 'function')
    throw new TypeError('stableStringify: unsupported value type Function')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  const proto = Object.getPrototypeOf(value) as object | null
  if (proto !== Object.prototype && proto !== null) {
    const name =
      (value as { constructor?: { name?: string } }).constructor?.name ?? 'unknown prototype'
    throw new TypeError(`stableStringify: unsupported value type ${name}`)
  }
  const keys = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
  const body = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  )
  return `{${body.join(',')}}`
}

export function stateHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}
