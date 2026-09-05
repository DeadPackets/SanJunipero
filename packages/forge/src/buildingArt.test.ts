import { cpSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BUILDINGS_CONTENT_DIR, listCommittedBuildings } from './buildingArt.js'

function twoCells(): string {
  const root = mkdtempSync(join(tmpdir(), 'sj-buildings-'))
  for (const dir of ['bridge', 'cabin'])
    cpSync(join(BUILDINGS_CONTENT_DIR, dir), join(root, dir), { recursive: true })
  return root
}

describe('listCommittedBuildings', () => {
  it('skips a half-present directory, says so, and still returns the rest', () => {
    const root = twoCells()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      rmSync(join(root, 'cabin', 'cell.webp'))
      expect(listCommittedBuildings(root).map((c) => c.dir)).toEqual(['bridge'])
      expect(warn.mock.calls.flat().join(' ')).toContain('cabin')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a directory whose name and manifest disagree', () => {
    const root = twoCells()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renameSync(join(root, 'cabin'), join(root, 'shed'))
      expect(listCommittedBuildings(root).map((c) => c.dir)).toEqual(['bridge'])
      expect(warn.mock.calls.flat().join(' ')).toContain('shed')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
