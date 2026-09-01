import { describe, expect, it } from 'vitest'
import { BudgetExceededError } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from './schema.js'
import { MemoryStore, type MemoryRow, type MemoryTags } from './store.js'
import {
  GIST_LANES,
  GIST_MAX_CONSECUTIVE_FAILURES,
  GIST_MIN_CHARS,
  gistMemories,
  needsGist,
} from './gist.js'

const TAGS: MemoryTags = { people: [], place: 'meadow', objects: [], topics: [] }
const LONG = `Omar promised three planks by tomorrow. ${'The meadow is wide and quiet. '.repeat(20)}`
const SHORT = 'Omar promised three planks by tomorrow.'

async function store(): Promise<MemoryStore> {
  return new MemoryStore(openAgentDb(':memory:'), 'tamar', await FakeEmbedder.create())
}

const write = (mem: MemoryStore, kind: 'perception' | 'thought', text: string): Promise<number> =>
  mem.insertMemory({ tick: 100, kind, text, importance: 3, tags: TAGS })

const noPause = async (): Promise<void> => {}

async function rowsNamed(mem: MemoryStore, names: string[]): Promise<MemoryRow[]> {
  const ids: number[] = []
  for (const n of names) ids.push(await write(mem, 'perception', `${LONG}${n}`))
  return ids.map((id) => mem.getMemory(id)!)
}

describe('which memories are worth a gist', () => {
  it('only a long perception or action, and only while it has none', async () => {
    const mem = await store()
    expect(LONG.length).toBeGreaterThan(GIST_MIN_CHARS)
    const long = mem.getMemory(await write(mem, 'perception', LONG))!
    const short = mem.getMemory(await write(mem, 'perception', SHORT))!
    const thought = mem.getMemory(await write(mem, 'thought', LONG))!

    expect(needsGist(long)).toBe(true)
    expect(needsGist(short)).toBe(false)
    expect(needsGist(thought)).toBe(false)
    expect(needsGist({ ...long, gist: 'already short' })).toBe(false)
  })
})

describe('gistMemories', () => {
  it('writes the short form beside the row and leaves the raw text restorable', async () => {
    const mem = await store()
    const id = await write(mem, 'perception', LONG)
    const batch = await gistMemories(mem, { gist: async () => 'Omar owes three planks.' }, [
      mem.getMemory(id)!,
    ])

    expect(batch).toEqual({ written: 1, eligible: 1, failed: 0 })
    const row = mem.getMemory(id)!
    expect(row.gist).toBe('Omar owes three planks.')
    expect(row.text).toBe(LONG)
  })

  it('throws away a gist no shorter than the row it would replace', async () => {
    const mem = await store()
    const id = await write(mem, 'perception', LONG)
    const batch = await gistMemories(mem, { gist: async () => `${LONG} and more` }, [
      mem.getMemory(id)!,
    ])

    expect(batch).toEqual({ written: 0, eligible: 1, failed: 0 })
    expect(mem.getMemory(id)!.gist).toBeNull()
  })

  it('skips a refused row and gists the rest of the night', async () => {
    const mem = await store()
    const rows = await rowsNamed(mem, ['a', 'b', 'c'])
    const refuseB = async (t: string): Promise<string> => {
      if (t.endsWith('b')) throw new Error('[Inceptron] rate-limited upstream')
      return 'short'
    }

    const batch = await gistMemories(mem, { gist: refuseB }, rows, noPause)

    expect(batch).toEqual({ written: 2, eligible: 3, failed: 1 })
    expect(rows.map((r) => mem.getMemory(r.id)!.gist)).toEqual(['short', null, 'short'])
  })

  it('carries a refused row into a later night, which only sees its own day', async () => {
    const mem = await store()
    const lastNight = await rowsNamed(mem, ['a', 'b'])
    let busy = true
    const gist = async (t: string): Promise<string> => {
      if (busy && t.endsWith('b')) throw new Error('[Inceptron] rate-limited upstream')
      return 'short'
    }

    const first = await gistMemories(mem, { gist }, lastNight, noPause)
    busy = false
    const tonight = await rowsNamed(mem, ['c'])
    const second = await gistMemories(mem, { gist }, tonight, noPause)

    expect([first.written, first.failed]).toEqual([1, 1])
    // Tonight's own row plus the one last night could not write.
    expect(second).toEqual({ written: 2, eligible: 2, failed: 0 })
    expect(mem.getMemory(lastNight[1]!.id)!.gist).toBe('short')
  })

  it('stops asking once the endpoint has refused the night', async () => {
    const mem = await store()
    const names = Array.from({ length: 12 }, (_, i) => `r${i}`)
    const rows = await rowsNamed(mem, names)
    let asked = 0

    const batch = await gistMemories(
      mem,
      {
        gist: async () => {
          asked += 1
          throw new Error('[Inceptron] rate-limited upstream')
        },
      },
      rows,
      noPause,
    )

    expect(batch.written).toBe(0)
    expect(batch.eligible).toBe(names.length)
    // The lanes in flight when the cap trips finish their own row, and no lane takes another.
    expect(asked).toBeLessThan(GIST_MAX_CONSECUTIVE_FAILURES + GIST_LANES)
    expect(asked).toBeGreaterThanOrEqual(GIST_MAX_CONSECUTIVE_FAILURES)
  })

  it('raises a night with no headroom rather than skipping past it', async () => {
    const mem = await store()
    const rows = await rowsNamed(mem, ['a', 'b'])
    const broke = async (): Promise<string> => {
      throw new BudgetExceededError('no headroom')
    }

    await expect(gistMemories(mem, { gist: broke }, rows, noPause)).rejects.toThrow('no headroom')
  })

  it('reports coverage over the rows that wanted a gist', async () => {
    const mem = await store()
    const rows = await rowsNamed(mem, ['a', 'b', 'c', 'd'])
    const short = mem.getMemory(await write(mem, 'perception', SHORT))!
    const refuseD = async (t: string): Promise<string> => {
      if (t.endsWith('d')) throw new Error('[Inceptron] rate-limited upstream')
      return 'short'
    }

    const batch = await gistMemories(mem, { gist: refuseD }, [...rows, short], noPause)

    expect(batch.eligible).toBe(rows.length)
    expect(batch.written / batch.eligible).toBe(0.75)
  })

  it('spends nothing on the rows that are already their own gist', async () => {
    const mem = await store()
    const asked: string[] = []
    const ids = [await write(mem, 'perception', SHORT), await write(mem, 'thought', LONG)]
    const batch = await gistMemories(
      mem,
      {
        gist: async (t) => {
          asked.push(t)
          return 'x'
        },
      },
      ids.map((id) => mem.getMemory(id)!),
    )

    expect([batch, asked]).toEqual([{ written: 0, eligible: 0, failed: 0 }, []])
  })
})
