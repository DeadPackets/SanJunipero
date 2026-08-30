import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The engine's tick graph is a DAG, and it is the hub-and-spoke shape that makes that worth
// asserting: `worldTick.ts` imports all 21 systems, and every system needs the type it is
// handed back. Until `TickCtx` and `dropHeldItems` moved off the hub, that closed an 8-module
// runtime cycle and a 24-module type-only one — 21 strongly-connected components in all.
//
// Wider than the one edge that closed them, on the C12a R2 principle `browserGraph.test.ts`
// states: a guard that only sees the exact defect already fixed buys false confidence. Every
// non-test source under `src` is a root, `import type` counts (it is a cycle for a reader and
// for every graph tool), and any relative edge is followed — not just `systems/ → worldTick`.

const SRC = dirname(fileURLToPath(import.meta.url))

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiersOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(src); m !== null; m = re.exec(src)) if (m[1] !== undefined) out.push(m[1])
  }
  return out
}

// './x.js' → './x.ts'; a directory → its index. Anything else (`@sj/shared`, `node:*`) is a
// leaf as far as this graph is concerned: no cycle can leave the package and come back.
function resolveRelative(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const c of [base.replace(/\.js$/, '.ts'), base, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function engineSourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...engineSourceFiles(p))
      continue
    }
    if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('.d.ts')) continue
    out.push(p)
  }
  return out
}

// Tarjan. The graph is ~50 nodes, so plain recursion is fine.
function cycles(files: string[]): string[][] {
  const edges = new Map(
    files.map((f) => [
      f,
      specifiersOf(f)
        .map((spec) => resolveRelative(spec, f))
        .filter((t): t is string => t !== null),
    ]),
  )
  const marks = new Map<string, { index: number; low: number }>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const found: string[][] = []
  let next = 0

  const strongConnect = (v: string): { index: number; low: number } => {
    const mark = { index: next, low: next }
    next += 1
    marks.set(v, mark)
    stack.push(v)
    onStack.add(v)
    for (const w of edges.get(v) ?? []) {
      const seen = marks.get(w)
      if (seen === undefined) mark.low = Math.min(mark.low, strongConnect(w).low)
      else if (onStack.has(w)) mark.low = Math.min(mark.low, seen.index)
    }
    if (mark.low !== mark.index) return mark
    const component: string[] = []
    for (let w = stack.pop(); w !== undefined; w = stack.pop()) {
      onStack.delete(w)
      component.push(relative(SRC, w))
      if (w === v) break
    }
    // A module is trivially its own component; only two or more is a cycle.
    if (component.length > 1) found.push(component.sort())
    return mark
  }

  for (const f of files) if (!marks.has(f)) strongConnect(f)
  return found
}

describe('★ the engine module graph', () => {
  const files = engineSourceFiles()

  it('roots at every source, not only the ones the hub reaches', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(files.map((f) => relative(SRC, f))).toContain('worldTick.ts')
  })

  it('has no cycles — `import type` counted, because a reader cannot erase one', () => {
    expect(cycles(files)).toEqual([])
  })
})
