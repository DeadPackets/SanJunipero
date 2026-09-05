import { describe, expect, it } from 'vitest'
import { encodePng, type AssetCodex, type RawImage } from '@sj/forge'
import { MAX_CUT, makeSpriteReader } from './agentCard.js'

const CELL = 8
const MANIFEST = JSON.stringify({
  version: 'v4-hires-atlas',
  figureH: CELL,
  cells: { 'idle-se': { x: 0, y: 0, w: CELL, h: CELL, feetX: 4, feetY: 7 } },
})

const flat: RawImage = {
  width: CELL,
  height: CELL,
  data: new Uint8ClampedArray(CELL * CELL * 4).fill(255),
}

/** Only what `makeSpriteReader` reads: the newest ready row for a kind, and its bytes. */
const codexOf = async (ids: readonly string[]): Promise<{ codex: AssetCodex; got: string[] }> => {
  const png = await encodePng(flat)
  const got: string[] = []
  const rows = ids.map((id, i) => ({ seq: i + 1, status: 'ready', kind: `character:${id}`, id }))
  const codex = {
    listSince: (seq: number) => rows.filter((r) => r.seq > seq),
    get: (id: string) => {
      got.push(id)
      return { png, record: { meta: MANIFEST } }
    },
  }
  return { codex: codex as unknown as AssetCodex, got }
}

describe('the cropped-bust memo', () => {
  it('holds a face it has cut, so a card GET does not re-crop a 748 KB sheet', async () => {
    const { codex, got } = await codexOf(['alice'])
    const sprite = makeSpriteReader(() => codex)
    expect(await sprite('alice')).toContain('data:image/png;base64,')
    await sprite('alice')
    expect(got).toEqual(['alice'])
  })

  // ★ Every sibling memo in the package caps; this one held every historical bust for the life
  // of the process, because a regenerated sheet never reuses its id.
  it('★ lets the oldest face go once it is full', async () => {
    const ids = Array.from({ length: MAX_CUT + 1 }, (_, i) => `a${i}`)
    const { codex, got } = await codexOf(ids)
    const sprite = makeSpriteReader(() => codex)
    for (const id of ids) await sprite(id)
    expect(got).toHaveLength(MAX_CUT + 1)
    await sprite(ids[0]!)
    expect(got, 'the oldest was let go').toHaveLength(MAX_CUT + 2)
    await sprite(ids[MAX_CUT]!)
    expect(got, 'the newest is still held').toHaveLength(MAX_CUT + 2)
  })
})
