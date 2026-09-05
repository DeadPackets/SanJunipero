import { cpSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ITEMS_CONTENT_DIR, listCommittedItems } from './committed.js'

function twoItems(): string {
  const root = mkdtempSync(join(tmpdir(), 'sj-items-'))
  for (const kind of ['anvil', 'axe'])
    cpSync(join(ITEMS_CONTENT_DIR, kind), join(root, kind), { recursive: true })
  return root
}

describe('listCommittedItems', () => {
  it('skips a half-present directory, says so, and still returns the rest', () => {
    const root = twoItems()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      rmSync(join(root, 'axe', 'icon.webp'))
      expect(listCommittedItems(root).map((i) => i.kind)).toEqual(['anvil'])
      expect(warn.mock.calls.flat().join(' ')).toContain('axe')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips a directory whose name and manifest disagree', () => {
    const root = twoItems()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renameSync(join(root, 'axe'), join(root, 'bed'))
      expect(listCommittedItems(root).map((i) => i.kind)).toEqual(['anvil'])
      expect(warn.mock.calls.flat().join(' ')).toContain('bed')
    } finally {
      warn.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
