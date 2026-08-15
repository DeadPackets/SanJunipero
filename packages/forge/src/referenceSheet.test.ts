import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReferenceSheet } from './referenceSheet.js'

describe('loadReferenceSheet', () => {
  it('loads exactly ref-1..3.png from the given dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-refs-'))
    try {
      for (const n of [1, 2, 3]) writeFileSync(join(dir, `ref-${n}.png`), Buffer.from(`png${n}`))
      const refs = loadReferenceSheet(dir)
      expect(refs).toHaveLength(3)
      expect(refs[2]!.toString()).toBe('png3')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('throws a task-pointing error when a ref is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-refs-'))
    try { expect(() => loadReferenceSheet(dir)).toThrow(/gen-reference-sheet/) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
