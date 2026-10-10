import { describe, expect, it } from 'vitest'
import type { AssetRecord } from '@sj/shared'
import { bootAssetUrls, loadBootAssets } from './bootAssets.js'

const art = (id: string, kind: string | null, seq: number, status = 'ready'): AssetRecord =>
  ({ id, kind, seq, status, class: 'building', meta: null }) as AssetRecord

describe('town asset preparation', () => {
  it('loads latest catalog art and all current residents, excluding replaced and unfinished art', () => {
    const urls = bootAssetUrls(
      [
        art('old', 'pub', 1),
        art('new', 'pub', 2),
        art('unfinished', 'pub', 3, 'placeholder'),
        art('departed', 'character:gone', 4),
        art('orphan-map', null, 5),
      ],
      ['nadia', 'amara'],
    )
    expect(urls).toContain('/assets/new.png')
    expect(urls).toContain('/assets/character/nadia.png')
    expect(urls).toContain('/assets/character/amara.png')
    expect(urls).not.toContain('/assets/old.png')
    expect(urls).not.toContain('/assets/unfinished.png')
    expect(urls).not.toContain('/assets/departed.png')
    expect(urls).not.toContain('/assets/orphan-map.png')
  })

  it('waits for decoding, limits concurrency to six, and reports failed assets for retry', async () => {
    let active = 0
    let peak = 0
    const finished: number[] = []
    const failed = await loadBootAssets(
      Array.from({ length: 20 }, (_, i) => String(i)),
      async (url) => {
        peak = Math.max(peak, ++active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active--
        if (url === '3') throw new Error('decode failed')
      },
      (n) => finished.push(n),
      new AbortController().signal,
    )
    expect(peak).toBe(6)
    expect(active).toBe(0)
    expect(failed).toEqual(['3'])
    expect(finished).toEqual(Array.from({ length: 21 }, (_, i) => i))
  })

  it('stops scheduling work when the mount is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    let started = 0
    await expect(
      loadBootAssets(
        ['one'],
        async () => {
          started++
        },
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(started).toBe(0)
  })
})
