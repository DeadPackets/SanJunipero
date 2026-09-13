// The 8x8 grid every pixel mark over the town is drawn on, at twice its size.
const GLYPH_PX = 8
const GLYPH_SCALE = 2

/** One mark, drawn as whole cells rather than a font glyph or an emoji: the sheet's own faces
 *  are on an 8px grid, and a character scaled off that grid lands its strokes between pixels. */
export function PixelGlyph({
  pixels,
  className,
  px = GLYPH_PX,
  scale = GLYPH_SCALE,
}: {
  /** a fill of `null` takes the element's own colour, which is where the token lives */
  pixels: readonly (readonly [number, number, string?])[]
  className: string
  /** the grid the art was drawn on, where it is not the town's usual 8 */
  px?: number
  /** whole numbers only, or the art is resampled and its strokes land between pixels */
  scale?: number
}) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${px} ${px}`}
      width={px * scale}
      height={px * scale}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill ?? 'currentColor'} />
      ))}
    </svg>
  )
}
