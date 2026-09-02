// The 8x8 grid every pixel mark over the town is drawn on.
const GLYPH_PX = 8

/** One mark, drawn as whole cells rather than a font glyph or an emoji: the sheet's own faces
 *  are on an 8px grid, and a character scaled off that grid lands its strokes between pixels. */
export function PixelGlyph({
  pixels,
  className,
}: {
  /** a fill of `null` takes the element's own colour, which is where the token lives */
  pixels: readonly (readonly [number, number, string?])[]
  className: string
}) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2}
      height={GLYPH_PX * 2}
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
