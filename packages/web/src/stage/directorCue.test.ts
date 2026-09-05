import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONSTRUCT_VOCABULARY, momentTitle, SceneKind } from '@sj/shared'

// ★ `council` is a construct type, and the stamp was printing the enum id straight from the
// wire. One-way glass: the machinery's own word must never be struck onto the picture.
describe('★ the scene stamp is prose, never the wire’s own word for the scene', () => {
  const SRC = readFileSync(new URL('./DirectorCue.tsx', import.meta.url), 'utf8')
  const stamp = /function SceneStamp\([\s\S]*?\n\}/.exec(SRC)![0]

  it('★ renders the town’s title for the kind, not the kind', () => {
    expect(stamp, 'the raw enum id was the stamp text').not.toMatch(/\{kind\}/)
    expect(stamp).toContain('momentTitle(kind, null)')
  })

  it('★ no kind the gateway can send carries an ops word onto the glass', () => {
    for (const kind of SceneKind.options) {
      const word = momentTitle(kind, null)
      expect(word, kind).not.toBe(kind)
      for (const ops of CONSTRUCT_VOCABULARY)
        expect(word.toLowerCase(), `${kind} -> ${word}`).not.toContain(ops.toLowerCase())
    }
  })
})
