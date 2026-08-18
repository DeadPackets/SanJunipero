import { BitmapText, Cache, Container, Text } from 'pixi.js'
import { FACE_PX } from './textFaces.js'

// EVERY GLYPH THE WORLD DRAWS IS BUILT HERE.
//
// `new BitmapText(...)` for a font that is not installed does not fall back. It throws
// inside the renderer — "Cannot read properties of null (reading 'alphaMode')" — and the
// ENTIRE CANVAS goes blank (controller ruling R3). One label belonging to a task that has
// not landed yet costs the whole view, and no unit test sees it because the throw happens in
// a render pass.
//
// So the choice is made once, from the font cache, before any renderer touches the object:
// a bitmap glyph when the font is provably installed, a canvas glyph when it is not, and an
// empty node if even that fails. A label may cost itself. It may never cost the view.

/** The family a world label falls back to when it is not told which face it wants. Task 88
 *  installed the pixel BitmapFont under this name, so the fallback this module was built for
 *  is now the upgrade: every call site reads bitmap glyphs without having been edited. */
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
  readonly anchor = { set: (): void => {} }
}

export function createWorldLabel(text: string, style: WorldLabelStyle): WorldLabel {
  if (bitmapFontInstalled(style.fontFamily)) {
    try {
      return new BitmapText({ text, style }) as unknown as WorldLabel
    } catch {
      /* the font said it was there and was not — fall through to a canvas glyph */
    }
  }
  try {
    const t = new Text({ text, style })
    t.resolution = LABEL_RESOLUTION
    return t as unknown as WorldLabel
  } catch {
    return new VoidLabel() as unknown as WorldLabel
  }
}
