import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CharacterAtlasManifestSchema, type CharacterAtlasManifest } from '@sj/shared'
import { BudgetExceededError } from './budget.js'
import { CAST_CONTENT_DIR } from './castArt.js'
import { CAST_V5, lookFor, yearsInWords, type CastLook } from './castLooks.js'
import {
  CHARACTER_IMAGES_MIN,
  commissionCharacter,
  committedProportionRef,
  masterPrompt,
  onMagenta,
  type CharacterDeps,
  type CharacterImage,
} from './characterCommission.js'
import { CELL_NAMES_V4 } from './mirror.js'
import { trimToFigure } from './hires.js'
import { CHAR_CELL_PX } from './reCell.js'
import { decodePng, downscaleNearest, encodePng, type RawImage } from './post/raw.js'

// THE PROVIDER IS A COMMITTED SHEET. Every "generation" this test buys is a real cell off a
// shipped character, blown back up to the factor its raw was cut on and put back on magenta —
// so the gates the pipeline runs are reading art that once passed them, and no image is bought.
const SUBJECT = 'mira'
const RAW_FACTOR = 2048 / CHAR_CELL_PX

const committedManifest = (id: string): CharacterAtlasManifest =>
  CharacterAtlasManifestSchema.parse(
    JSON.parse(readFileSync(join(CAST_CONTENT_DIR, id, 'manifest.json'), 'utf8')),
  )

async function sheetOf(id: string): Promise<{ cell: (name: string) => RawImage }> {
  const dir = join(CAST_CONTENT_DIR, id)
  const atlas = await decodePng(readFileSync(join(dir, 'atlas.webp')))
  const { cells } = CharacterAtlasManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')),
  )
  return {
    cell: (name) => {
      const r = cells[name]!
      const out: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
      for (let y = 0; y < r.h; y++) {
        const s = ((r.y + y) * atlas.width + r.x) * 4
        out.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
      }
      const t = trimToFigure(out)
      return downscaleNearest(t, t.width * RAW_FACTOR, t.height * RAW_FACTOR)
    },
  }
}

/** The cell a candidate key is asking for. `master-*` is the pair; the rest are one figure. */
function cellFor(key: string): string | 'pair' {
  if (key.startsWith('master-')) return 'pair'
  if (key.startsWith('sleep-')) return 'sleep-se'
  const [, , facing, ...rest] = key.split('-')
  const pose = rest.slice(0, -1).join('-') // drop the `cN` attempt suffix
  return `${pose === 'passing' ? 'passing-a' : pose}-${facing!}`
}

describe('★ a person the town made goes through the founders’ own gates', () => {
  let bought: string[] = []

  const provider = async (
    cell: (name: string) => RawImage,
    key: string,
    swap?: (name: string) => string,
  ): Promise<CharacterImage> => {
    bought.push(key)
    const want = cellFor(key)
    if (want === 'pair') return { png: await pairPng(cell), model: 'fixture', costUsd: 0.1437 }
    const name = swap === undefined ? want : swap(want)
    return {
      png: await encodePng(onMagenta(cell(name))),
      model: 'fixture',
      costUsd: 0.1437,
    }
  }

  async function pairPng(cell: (name: string) => RawImage): Promise<Buffer> {
    const se = cell('idle-se'),
      ne = cell('idle-ne')
    const gap = Math.round(Math.max(se.width, ne.width) * 0.5)
    const width = se.width + gap + ne.width
    const height = Math.max(se.height, ne.height)
    const pair: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
    for (const [img, ox] of [
      [se, 0],
      [ne, se.width + gap],
    ] as const) {
      const oy = height - img.height
      for (let y = 0; y < img.height; y++)
        pair.data.set(
          img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4),
          ((oy + y) * width + ox) * 4,
        )
    }
    return encodePng(onMagenta(pair))
  }

  const look: CastLook = CAST_V5.find((c) => c.id === SUBJECT)!

  const deps = async (swap?: (name: string) => string): Promise<CharacterDeps> => {
    const { cell } = await sheetOf(SUBJECT)
    bought = []
    return {
      attempts: 1,
      proportionRef: null,
      generate: ({ key }) => provider(cell, key, swap),
    }
  }

  it('draws the 24-cell contract and a manifest the renderer’s own schema parses', async () => {
    const sheet = await commissionCharacter(await deps(), look)
    expect(sheet, 'the committed art no longer clears the pipeline it came out of').not.toBeNull()
    expect([...sheet!.cells.keys()].sort()).toEqual([...CELL_NAMES_V4].sort())
    expect(() => CharacterAtlasManifestSchema.parse(sheet!.manifest)).not.toThrow()
    expect(Object.keys(sheet!.manifest.cells).sort()).toEqual([...CELL_NAMES_V4].sort())
    expect(sheet!.figureH).toBeGreaterThan(0)
    expect(sheet!.atlas.length).toBeGreaterThan(0)
  }, 60_000)

  it('costs eight pictures when every cell passes first time', async () => {
    await commissionCharacter(await deps(), look)
    expect(bought).toHaveLength(CHARACTER_IMAGES_MIN)
    expect(bought.filter((k) => k.startsWith('master-'))).toHaveLength(1)
    expect(bought.filter((k) => k.startsWith('walk-'))).toHaveLength(6)
    expect(bought.filter((k) => k.startsWith('sleep-'))).toHaveLength(1)
  }, 60_000)

  it('★ a stride trio that does not stride is refused, and nothing is written', async () => {
    const reasons: string[] = []
    // Every walk frame comes back as the idle: three identical frames, no stride between them.
    const d = await deps(() => 'idle-se')
    const sheet = await commissionCharacter({ ...d, onRefused: (r) => reasons.push(r) }, look)
    expect(sheet).toBeNull()
    expect(reasons.join(' ')).toMatch(/stance|stride|silhouette|head/)
    expect(reasons.join(' ')).toContain('Nothing is written for this character')
  }, 60_000)

  it('★ a budget stop is not a refusal — it leaves by the caller', async () => {
    const d = await deps()
    await expect(
      commissionCharacter(
        {
          ...d,
          generate: () => {
            throw new BudgetExceededError(1.25, 1.3)
          },
        },
        look,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('a candidate refused by eye is never bought', async () => {
    const d = await deps()
    const reasons: string[] = []
    await commissionCharacter(
      { ...d, rejected: new Set([`master-${SUBJECT}-c0`]), onRefused: (r) => reasons.push(r) },
      look,
    )
    expect(bought).toEqual([])
    expect(reasons.join(' ')).toContain('every master candidate failed')
  })

  it('reads the committed anchor off disk, and says so in the master prompt', async () => {
    expect(await committedProportionRef()).not.toBeNull()
    expect(masterPrompt(look, true)).toContain('ANOTHER villager of this same game')
    expect(masterPrompt(look, false)).not.toContain('ANOTHER villager of this same game')
  })
})

describe('the look of somebody nobody authored', () => {
  const mira = { id: 'agent_41', sex: 'f' as const, ageYears: 31 }

  it('is the same costume every time, on any machine', () => {
    expect(lookFor(mira)).toEqual(lookFor({ ...mira }))
    expect(lookFor(mira).desc).not.toEqual(lookFor({ ...mira, id: 'agent_42' }).desc)
  })

  it('names three features and closes them, the way the authored sixteen do', () => {
    const look = lookFor(mira)
    expect(look.featureCap).toContain('Only THREE signature features')
    expect(look.featureCap).toContain('Both hands are EMPTY.')
    expect(look.desc).toContain('about 3 heads tall')
    expect(look.desc).toContain('of about thirty-one')
  })

  it('spells the age out, because the authored descs do', () => {
    expect(yearsInWords(31)).toBe('thirty-one')
    expect(yearsInWords(40)).toBe('forty')
    expect(yearsInWords(7)).toBe('seven')
  })

  it('gives a child a parent’s hair, and never invents a colour off the palette', () => {
    const omar = CAST_V5.find((c) => c.id === 'omar')!
    const amara = CAST_V5.find((c) => c.id === 'amara')!
    const child = lookFor({ id: 'agent_77', sex: 'm', ageYears: 4 }, [amara, omar])
    // Amara is the only one of the two whose desc names a hair colour, so it is hers either way.
    expect(child.desc).toContain('dark hair')
  })

  it('carries no id, no number and no machinery into the prompt', () => {
    const look = lookFor({ id: 'agent_41', sex: 'm', ageYears: 58 })
    for (const text of [look.desc, look.featureCap]) {
      expect(text).not.toContain('agent_41')
      // "about 3 heads tall" is the authored sixteen's own clause and stays; nothing else counts.
      expect(text.replace('about 3 heads tall', '')).not.toMatch(/\d/)
      expect(text).not.toMatch(/\b(prompt|model|token|seed)\b/i)
    }
  })
})

describe('the committed cast is still readable as fixtures', () => {
  it('every authored id has a manifest the schema parses', () => {
    for (const c of CAST_V5) expect(committedManifest(c.id).version).toBe('v4-hires-atlas')
  })
})
