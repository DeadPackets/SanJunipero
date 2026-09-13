/** The town's own pixels. Every mark, glyph and motif the chrome draws is painted from this
 *  palette, never from an emoji whose shape and colour belong to the reader's font. */
export const INK = '#43394A'
export const DEEP = '#241F2B'
export const HONEY = '#F2C879'
export const SAGE = '#93B573'
export const WATER = '#7FB0C9'
export const ROSE = '#C47876'
export const EMBER = '#E8785A'
export const STONE = '#ABA198'
export const SAND = '#E8D5BC'
export const CREAM = '#FFF6E9'
const DEEP_WATER = '#5A8CAB'
const ICE = '#D6EAF2'

export type Pixel = readonly [number, number, string]

const KEY: Readonly<Record<string, string>> = {
  i: INK,
  d: DEEP,
  h: HONEY,
  g: SAGE,
  w: WATER,
  b: DEEP_WATER,
  c: ICE,
  r: ROSE,
  e: EMBER,
  s: STONE,
  a: SAND,
}

/** Rows of a fixed-width grid: `.` is empty and every other letter is a palette key. Written as
 *  pictures, because a table of coordinates is a picture nobody can read. */
export function art(...rows: string[]): Pixel[] {
  const out: Pixel[] = []
  rows.forEach((row, y) => {
    // by code unit, not code point: x is the column in a fixed-width ASCII grid
    for (let x = 0; x < row.length; x++) {
      const fill = KEY[row.charAt(x)]
      if (fill !== undefined) out.push([x, y, fill] as const)
    }
  })
  return out
}
