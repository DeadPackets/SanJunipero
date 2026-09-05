import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CAST_CONTENT_DIR, listCommittedCast } from './castArt.js'

function twoSheets(): string {
  const root = mkdtempSync(join(tmpdir(), 'sj-cast-'))
  for (const id of ['amara', 'bashir'])
    cpSync(join(CAST_CONTENT_DIR, id), join(root, id), { recursive: true })
  return root
}

describe('listCommittedCast', () => {
  it('skips a half-present sheet, says so, and still returns the rest', () => {
    const root = twoSheets()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      rmSync(join(root, 'bashir', 'atlas.webp'))
      expect(listCommittedCast(root).map((c) => c.id)).toEqual(['amara'])
      expect(warn.mock.calls.flat().join(' ')).toContain('bashir')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a sheet whose manifest is short of a cell', () => {
    const root = twoSheets()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const path = join(root, 'bashir', 'manifest.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { cells: Record<string, unknown> }
      delete manifest.cells['idle-sw']
      writeFileSync(path, JSON.stringify(manifest))
      expect(listCommittedCast(root).map((c) => c.id)).toEqual(['amara'])
      expect(warn.mock.calls.flat().join(' ')).toContain('bashir')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
