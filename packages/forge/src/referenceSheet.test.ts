import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReferenceSheet } from './referenceSheet.js'

describe('loadReferenceSheet', () => {
  it('returns [style-anchor, ref-1..3] with the canonical anchor first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-refs-'))
    try {
      writeFileSync(join(dir, 'style-anchor.png'), Buffer.from('anchor'))
      for (const n of [1, 2, 3]) writeFileSync(join(dir, `ref-${n}.png`), Buffer.from(`png${n}`))
      const refs = loadReferenceSheet(dir)
      expect(refs).toHaveLength(4)
      expect(refs[0]!.toString()).toBe('anchor')
      expect(refs[3]!.toString()).toBe('png3')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('throws a task-pointing error when a ref is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-refs-'))
    try {
      writeFileSync(join(dir, 'style-anchor.png'), Buffer.from('anchor'))
      expect(() => loadReferenceSheet(dir)).toThrow(/gen-reference-sheet/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('throws when the canonical style anchor is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sj-refs-'))
    try {
      for (const n of [1, 2, 3]) writeFileSync(join(dir, `ref-${n}.png`), Buffer.from(`png${n}`))
      expect(() => loadReferenceSheet(dir)).toThrow(/style-anchor/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
