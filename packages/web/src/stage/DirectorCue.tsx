import { chronicleGlyph } from '../ui/importantFeed.js'
import { CUE_ICON_PX, type StageCue } from '../ui/stageCue.js'

const GLYPH_GRID = 8

/** Decorative: the sentence beside it carries the meaning, the way the feed's own glyph does. */
function CueGlyph({ icon }: { icon: string }) {
  return (
    <svg
      className="stage-cue-glyph"
      viewBox={`0 0 ${GLYPH_GRID} ${GLYPH_GRID}`}
      width={CUE_ICON_PX}
      height={CUE_ICON_PX}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {chronicleGlyph(icon).pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

/** The slot says what just HAPPENED while there is something, and what the shot is otherwise:
 *  a moment outranks a caption, and there is only ever one line here. */
export function DirectorCue({ text, moment }: { text: string | null; moment: StageCue | null }) {
  if (moment !== null) {
    return (
      <p className="stage-cue" data-moment="on">
        <CueGlyph icon={moment.icon} />
        {moment.text}
      </p>
    )
  }
  if (text === null || text.trim() === '') return null
  return <p className="stage-cue">{text}</p>
}
