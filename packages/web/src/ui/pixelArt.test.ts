import { describe, expect, it } from 'vitest'
import { CHRONICLE_GLYPH } from './importantFeed.js'
import { MOTIFS } from './momentThumb.js'
import { WEATHER_GLYPH } from './townStats.js'
import type { Pixel } from './pixelArt.js'

/** ★ THE PIXELS THE TUPLE TABLES DREW. Three glyph tables were written as [x,y,fill] tuples and
 *  are now written as `art()` picture rows. This is what the tuples produced, sorted, so the
 *  rewrite is provably a no-change and any later edit to a row has to be meant. */
const DRAWN: Readonly<Record<string, string>> = {
  'chronicle:cross':
    '1,3,#43394A 2,3,#43394A 3,1,#43394A 3,2,#43394A 3,3,#43394A 3,4,#43394A 3,5,#43394A 3,6,#43394A 4,1,#43394A 4,2,#43394A 4,3,#43394A 4,4,#43394A 4,5,#43394A 4,6,#43394A 5,3,#43394A 6,3,#43394A',
  'chronicle:spark':
    '0,3,#F2C879 0,4,#F2C879 1,3,#F2C879 1,4,#F2C879 2,2,#E8D5BC 2,5,#E8D5BC 3,0,#F2C879 3,1,#F2C879 3,3,#F2C879 3,4,#F2C879 3,5,#F2C879 3,6,#F2C879 4,0,#F2C879 4,1,#F2C879 4,3,#F2C879 4,4,#F2C879 4,5,#F2C879 4,6,#F2C879 5,2,#E8D5BC 5,5,#E8D5BC 6,3,#F2C879 6,4,#F2C879 7,3,#F2C879 7,4,#F2C879',
  'chronicle:heart':
    '1,2,#C47876 1,3,#C47876 2,1,#C47876 2,3,#C47876 2,4,#C47876 3,2,#C47876 3,3,#C47876 3,4,#C47876 3,5,#C47876 4,2,#C47876 4,3,#C47876 4,4,#C47876 4,5,#C47876 5,1,#C47876 5,3,#C47876 5,4,#C47876 6,2,#C47876 6,3,#C47876',
  'chronicle:house':
    '1,3,#93B573 1,4,#93B573 1,5,#93B573 1,6,#93B573 2,2,#93B573 2,4,#E8D5BC 2,5,#E8D5BC 2,6,#E8D5BC 3,1,#93B573 3,4,#E8D5BC 3,5,#43394A 3,6,#43394A 4,1,#93B573 4,4,#E8D5BC 4,5,#43394A 4,6,#43394A 5,2,#93B573 5,4,#E8D5BC 5,5,#E8D5BC 5,6,#E8D5BC 6,3,#93B573 6,4,#93B573 6,5,#93B573 6,6,#93B573',
  'chronicle:flame':
    '2,2,#E8785A 2,3,#E8785A 2,4,#E8785A 3,0,#E8785A 3,1,#E8785A 3,2,#E8785A 3,3,#E8785A 3,3,#F2C879 3,4,#E8785A 3,5,#E8785A 4,1,#E8785A 4,2,#E8785A 4,3,#E8785A 4,4,#E8785A 4,4,#F2C879 4,5,#E8785A 5,2,#E8785A 5,3,#E8785A 5,4,#E8785A',
  'chronicle:quill':
    '1,5,#7FB0C9 1,6,#43394A 2,4,#7FB0C9 2,5,#7FB0C9 2,6,#43394A 3,3,#7FB0C9 3,4,#7FB0C9 3,6,#43394A 4,2,#7FB0C9 4,3,#7FB0C9 4,6,#43394A 5,1,#7FB0C9 5,2,#7FB0C9 5,6,#43394A 6,0,#7FB0C9 6,1,#7FB0C9',
  'chronicle:leaf':
    '1,6,#43394A 2,5,#43394A 2,5,#93B573 3,3,#93B573 3,4,#43394A 3,4,#93B573 3,5,#93B573 4,2,#93B573 4,3,#43394A 4,3,#93B573 4,4,#93B573 4,5,#93B573 5,1,#93B573 5,2,#43394A 5,2,#93B573 5,3,#93B573 5,4,#93B573 6,1,#43394A 6,1,#93B573 6,2,#93B573 6,3,#93B573',
  'chronicle:road':
    '0,2,#ABA198 0,3,#E8D5BC 0,4,#E8D5BC 0,5,#ABA198 1,2,#ABA198 1,3,#43394A 1,3,#E8D5BC 1,4,#E8D5BC 1,5,#ABA198 2,2,#ABA198 2,3,#43394A 2,3,#E8D5BC 2,4,#E8D5BC 2,5,#ABA198 3,2,#ABA198 3,3,#E8D5BC 3,4,#E8D5BC 3,5,#ABA198 4,2,#ABA198 4,3,#E8D5BC 4,4,#E8D5BC 4,5,#ABA198 5,2,#ABA198 5,3,#43394A 5,3,#E8D5BC 5,4,#E8D5BC 5,5,#ABA198 6,2,#ABA198 6,3,#43394A 6,3,#E8D5BC 6,4,#E8D5BC 6,5,#ABA198 7,2,#ABA198 7,3,#E8D5BC 7,4,#E8D5BC 7,5,#ABA198',
  'chronicle:key':
    '1,2,#43394A 1,3,#43394A 2,1,#43394A 2,4,#43394A 3,1,#43394A 3,2,#F2C879 3,3,#F2C879 3,4,#43394A 3,5,#43394A 3,6,#43394A 3,7,#43394A 4,1,#43394A 4,4,#43394A 4,6,#43394A 5,2,#43394A 5,3,#43394A',
  'chronicle:star':
    '0,3,#ABA198 0,4,#ABA198 1,3,#ABA198 1,4,#ABA198 2,3,#ABA198 2,4,#ABA198 3,0,#ABA198 3,1,#ABA198 3,3,#E8D5BC 3,4,#E8D5BC 3,6,#ABA198 3,7,#ABA198 4,0,#ABA198 4,1,#ABA198 4,3,#E8D5BC 4,4,#E8D5BC 4,6,#ABA198 4,7,#ABA198 5,3,#ABA198 5,4,#ABA198 6,3,#ABA198 6,4,#ABA198 7,3,#ABA198 7,4,#ABA198',
  'weather:sunny':
    '0,2,#F2C879 0,3,#F2C879 2,2,#F2C879 2,3,#F2C879 3,1,#F2C879 3,2,#F2C879 3,3,#F2C879 3,4,#F2C879 3,6,#F2C879 4,1,#F2C879 4,2,#F2C879 4,3,#F2C879 4,4,#F2C879 4,6,#F2C879 5,2,#F2C879 5,3,#F2C879 7,2,#F2C879 7,3,#F2C879',
  'weather:cloudy':
    '1,2,#ABA198 1,3,#ABA198 2,1,#ABA198 2,2,#ABA198 2,3,#ABA198 3,1,#ABA198 3,2,#ABA198 3,3,#ABA198 4,1,#ABA198 4,2,#ABA198 4,3,#ABA198 5,2,#ABA198 5,3,#ABA198 6,2,#ABA198 6,3,#ABA198',
  'weather:rain':
    '1,2,#ABA198 1,3,#ABA198 2,1,#ABA198 2,2,#ABA198 2,3,#ABA198 2,5,#7FB0C9 2,6,#7FB0C9 3,1,#ABA198 3,2,#ABA198 3,3,#ABA198 4,1,#ABA198 4,2,#ABA198 4,3,#ABA198 4,5,#7FB0C9 4,6,#7FB0C9 5,2,#ABA198 5,3,#ABA198 6,2,#ABA198 6,3,#ABA198 6,5,#7FB0C9 6,6,#7FB0C9',
  'weather:storm':
    '1,2,#5A8CAB 1,3,#5A8CAB 2,1,#5A8CAB 2,2,#5A8CAB 2,3,#5A8CAB 3,1,#5A8CAB 3,2,#5A8CAB 3,3,#5A8CAB 3,5,#F2C879 3,6,#F2C879 4,1,#5A8CAB 4,2,#5A8CAB 4,3,#5A8CAB 4,4,#F2C879 4,5,#F2C879 5,2,#5A8CAB 5,3,#5A8CAB 6,2,#5A8CAB 6,3,#5A8CAB',
  'weather:snow':
    '1,2,#ABA198 1,3,#ABA198 2,1,#ABA198 2,2,#ABA198 2,3,#ABA198 2,5,#D6EAF2 3,1,#ABA198 3,2,#ABA198 3,3,#ABA198 3,6,#D6EAF2 4,1,#ABA198 4,2,#ABA198 4,3,#ABA198 5,2,#ABA198 5,3,#ABA198 5,5,#D6EAF2 6,2,#ABA198 6,3,#ABA198 6,6,#D6EAF2',
  'weather:—': '2,3,#ABA198 3,3,#ABA198 4,3,#ABA198 5,3,#ABA198',
  'motif:stone':
    '1,2,#ABA198 1,3,#ABA198 1,4,#E8D5BC 2,2,#ABA198 2,3,#ABA198 2,4,#43394A 2,4,#E8D5BC 3,2,#43394A 3,2,#ABA198 3,3,#ABA198 3,4,#E8D5BC 4,2,#ABA198 4,3,#ABA198 4,4,#E8D5BC 5,2,#ABA198 5,3,#ABA198 5,4,#43394A 5,4,#E8D5BC 6,2,#ABA198 6,3,#ABA198 6,4,#E8D5BC',
  'motif:water':
    '0,2,#7FB0C9 0,5,#7FB0C9 1,3,#7FB0C9 1,4,#7FB0C9 2,2,#7FB0C9 2,5,#7FB0C9 3,3,#7FB0C9 3,4,#7FB0C9 4,2,#7FB0C9 4,5,#7FB0C9 5,3,#7FB0C9 5,4,#7FB0C9 6,2,#7FB0C9 6,5,#7FB0C9 7,3,#7FB0C9 7,4,#7FB0C9',
  'motif:field':
    '0,5,#E8D5BC 1,1,#93B573 1,2,#93B573 1,3,#F2C879 1,5,#E8D5BC 2,5,#E8D5BC 3,1,#93B573 3,2,#93B573 3,3,#F2C879 3,5,#E8D5BC 4,5,#E8D5BC 5,1,#93B573 5,2,#93B573 5,3,#F2C879 5,5,#E8D5BC 6,5,#E8D5BC 7,5,#E8D5BC',
  'motif:hearth':
    '1,3,#43394A 1,4,#43394A 1,5,#43394A 2,4,#E8785A 2,5,#43394A 3,3,#E8785A 3,4,#E8785A 3,4,#F2C879 3,5,#43394A 4,3,#E8785A 4,4,#E8785A 4,5,#43394A 5,4,#E8785A 5,5,#43394A 6,3,#43394A 6,4,#43394A 6,5,#43394A',
  'motif:tree':
    '1,2,#93B573 2,1,#93B573 2,2,#93B573 2,3,#93B573 3,0,#93B573 3,1,#93B573 3,2,#93B573 3,3,#93B573 3,4,#43394A 3,5,#43394A 4,0,#93B573 4,1,#93B573 4,2,#93B573 4,3,#93B573 4,4,#43394A 4,5,#43394A 5,1,#93B573 5,2,#93B573 5,3,#93B573 6,2,#93B573',
}

const sig = (pixels: readonly Pixel[]): string =>
  [...pixels]
    .map(([x, y, fill]) => `${String(x)},${String(y)},${fill}`)
    .sort()
    .join(' ')

describe('★ the glyph tables draw what their tuples drew', () => {
  it('draws every chronicle glyph pixel for pixel', () => {
    for (const [icon, glyph] of Object.entries(CHRONICLE_GLYPH))
      expect(sig(glyph.pixels), icon).toBe(DRAWN[`chronicle:${icon}`])
  })

  it('draws every weather glyph pixel for pixel', () => {
    for (const [kind, glyph] of Object.entries(WEATHER_GLYPH))
      expect(sig(glyph.pixels), kind).toBe(DRAWN[`weather:${kind}`])
  })

  it('draws every postcard motif pixel for pixel', () => {
    for (const motif of MOTIFS)
      expect(sig(motif.pixels), motif.name).toBe(DRAWN[`motif:${motif.name}`])
  })

  it('has one snapshot per glyph and no orphan', () => {
    const drawn = [
      ...Object.keys(CHRONICLE_GLYPH).map((k) => `chronicle:${k}`),
      ...Object.keys(WEATHER_GLYPH).map((k) => `weather:${k}`),
      ...MOTIFS.map((m) => `motif:${m.name}`),
    ]
    expect(drawn.sort()).toEqual(Object.keys(DRAWN).sort())
  })
})
