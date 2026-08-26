import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NARRATOR_CANON } from './canon.js'
import { FORBIDDEN_FRAMING } from './llm/framing.js'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Task 1 offline part — probe mechanics pinned without a live call', () => {
  it('NARRATOR_CANON is the byte-stable diegetic historian prefix', () => {
    expect(NARRATOR_CANON.startsWith('You are the omniscient historian of San Junipero')).toBe(true)
    // Long enough that a provider-side prefix cache has something to hold.
    expect(NARRATOR_CANON.length).toBeGreaterThan(1000)
    expect(FORBIDDEN_FRAMING.test(NARRATOR_CANON)).toBe(false)
  })

  it('places the chronicler in the century the town actually lives in', () => {
    expect(NARRATOR_CANON).not.toMatch(/\bstone[- ]age\b/i)
    expect(NARRATOR_CANON).toMatch(/farm town/i)
  })

  it('probe script wires LlmClient with caller narrator and a $5 hard cap', () => {
    const src = readFileSync(join(pkgDir, 'scripts', 'probe.ts'), 'utf8')
    expect(src).toContain("caller: 'narrator'")
    expect(src).toContain('budgetUsd: 5.0')
    expect(src).toContain('migrateLlmTables')
    expect(src).toContain("openDb(':memory:')")
    expect(src).toContain('NARRATOR_CANON')
    expect(src).toContain('process.exit(1)')
    // The three checks the plan mandates.
    expect(src).toContain('CHECK 1')
    expect(src).toContain('CHECK 2')
    expect(src).toContain('CHECK 3')
  })

  it('probe runs through the agents ts-loader (NodeNext .js-in-imports)', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.probe).toBe('node --import ../agents/scripts/ts-loader.mjs scripts/probe.ts')
  })

  it('root typecheck covers @sj/narrator', () => {
    const root = JSON.parse(readFileSync(join(pkgDir, '..', '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(root.scripts.typecheck).toContain('packages/narrator')
  })
})
