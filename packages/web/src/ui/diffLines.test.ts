import { describe, expect, it } from 'vitest'
import { diffLines } from './diffLines.js'

describe('diffLines', () => {
  it('marks one changed line as del+add between same lines', () => {
    const a = 'I am patient.\nI fear the river.\nI trust the builder.'
    const b = 'I am patient.\nI no longer fear the river.\nI trust the builder.'
    expect(diffLines(a, b)).toEqual([
      { kind: 'same', text: 'I am patient.' },
      { kind: 'del', text: 'I fear the river.' },
      { kind: 'add', text: 'I no longer fear the river.' },
      { kind: 'same', text: 'I trust the builder.' },
    ])
  })
  it('identical docs are all same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ])
  })
  it('empty to doc is all add', () => {
    expect(diffLines('', 'x\ny')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' },
    ])
  })
})
