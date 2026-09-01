import { BitmapText, Cache, Container, Text } from 'pixi.js'
import { FACE_PX, inkedFace } from './textFaces.js'

// `new BitmapText(...)` for an uninstalled font throws inside the render pass and blanks the
// whole canvas, so the glyph class is picked from the font cache before the renderer sees it.

/** The family a world label falls back to when it is not told which face it wants. */
export const WORLD_FONT_FAMILY = FACE_PX

/** A canvas glyph at 12px would be resampled by NEAREST upscaling; 2 keeps it crisp. */
export const LABEL_RESOLUTION = 2

export type WorldLabelStyle = {
  fontFamily: string
  fontSize: number
  fill: number
  lineHeight?: number
  align?: 'left' | 'center' | 'right'
}

/** What every caller uses: a positioned node carrying text with an anchor. */
export type WorldLabel = Container & {
  text: string
  readonly anchor: { set: (x: number, y?: number) => void }
  readonly width: number
  readonly height: number
}

/** The cache key Pixi's BitmapFontManager stores a dynamically generated font under. */
export function bitmapFontKey(family: string): string {
  return `${family}-bitmap`
}

export function bitmapFontInstalled(family: string): boolean {
  return Cache.has(bitmapFontKey(family))
}

/** Last resort: takes every call a label takes, draws nothing, and cannot throw. */
class VoidLabel extends Container {
  text = ''
  readonly anchor = {
    set: (): void => {
      /* a void label has nothing to anchor */
    },
  }
}

export function createWorldLabel(text: string, style: WorldLabelStyle): WorldLabel {
  // The atlas is baked per ink, so the family a label asks for is the family PLUS its fill.
  const fontFamily = inkedFace(style.fontFamily, style.fill)
  if (bitmapFontInstalled(fontFamily)) {
    try {
      return new BitmapText({ text, style: { ...style, fontFamily } })
    } catch {
      /* the font said it was there and was not — fall through to a canvas glyph */
    }
  }
  try {
    const t = new Text({ text, style })
    t.resolution = LABEL_RESOLUTION
    return t
  } catch {
    return new VoidLabel()
  }
}
