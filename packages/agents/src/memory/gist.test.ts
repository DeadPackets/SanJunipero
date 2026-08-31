import { describe, expect, it } from 'vitest'
import { FakeEmbedder } from '@sj/llm/testutil'
import { openAgentDb } from './schema.js'
import { MemoryStore, type MemoryTags } from './store.js'
import { GIST_MIN_CHARS, gistMemories, needsGist } from './gist.js'

const TAGS: MemoryTags = { people: [], place: 'meadow', objects: [], topics: [] }
const LONG = `Omar promised three planks by tomorrow. ${'The meadow is wide and quiet. '.repeat(20)}`
const SHORT = 'Omar promised three planks by tomorrow.'

async function store(): Promise<MemoryStore> {
  return new MemoryStore(openAgentDb(':memory:'), 'tamar', await FakeEmbedder.create())
}

const write = (mem: MemoryStore, kind: 'perception' | 'thought', text: string): Promise<number> =>
  mem.insertMemory({ tick: 100, kind, text, importance: 3, tags: TAGS })

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
    const written = await gistMemories(mem, { gist: async () => 'Omar owes three planks.' }, [
      mem.getMemory(id)!,
    ])

    expect(written).toBe(1)
    const row = mem.getMemory(id)!
    expect(row.gist).toBe('Omar owes three planks.')
    expect(row.text).toBe(LONG)
  })

  it('throws away a gist no shorter than the row it would replace', async () => {
    const mem = await store()
    const id = await write(mem, 'perception', LONG)
    const written = await gistMemories(mem, { gist: async () => `${LONG} and more` }, [
      mem.getMemory(id)!,
    ])

    expect(written).toBe(0)
    expect(mem.getMemory(id)!.gist).toBeNull()
  })

  it('surfaces the first failure and keeps what the other lanes already wrote', async () => {
    const mem = await store()
    const ids = await Promise.all([
      write(mem, 'perception', `${LONG}a`),
      write(mem, 'perception', `${LONG}b`),
    ])
    const rows = ids.map((id) => mem.getMemory(id)!)
    const fail = async (t: string): Promise<string> => {
      if (t.endsWith('b')) throw new Error('no headroom')
      return 'short'
    }

    await expect(gistMemories(mem, { gist: fail }, rows)).rejects.toThrow('no headroom')
    expect(mem.getMemory(ids[0])!.gist).toBe('short')
  })

  it('spends nothing on the rows that are already their own gist', async () => {
    const mem = await store()
    const asked: string[] = []
    const ids = [await write(mem, 'perception', SHORT), await write(mem, 'thought', LONG)]
    const written = await gistMemories(
      mem,
      {
        gist: async (t) => {
          asked.push(t)
          return 'x'
        },
      },
      ids.map((id) => mem.getMemory(id)!),
    )

    expect([written, asked]).toEqual([0, []])
  })
})
