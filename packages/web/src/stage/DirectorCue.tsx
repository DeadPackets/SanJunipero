import { chronicleGlyph } from '../ui/importantFeed.js'
import { CUE_ICON_PX, STAKES_MAX, type SceneCue, type StageCue } from '../ui/stageCue.js'

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

/** The kind, struck like a stamp, with what is at stake measured along its foot. Two channels
 *  and one gesture: the ink says how hot and the rule says how hot, so neither is alone. */
function SceneStamp({ kind, stakes, band }: SceneCue) {
  return (
    <span
      className="stage-scene-stamp"
      data-stakes={band}
      style={stakes === null ? undefined : { ['--stakes' as string]: stakes / STAKES_MAX }}
    >
      {kind}
      {stakes !== null && (
        <span className="stage-sr">
          , {stakes} of {STAKES_MAX} at stake
        </span>
      )}
    </span>
  )
}

/** The slot says what just HAPPENED while there is something, what the town is DOING while a
 *  scene runs, and what the shot is otherwise. There is only ever one line here. */
export function DirectorCue({
  text,
  moment,
  scene,
}: {
  text: string | null
  moment: StageCue | null
  scene: SceneCue | null
}) {
  if (moment !== null) {
    return (
      <p className="stage-cue" data-moment="on">
        <CueGlyph icon={moment.icon} />
        {moment.text}
      </p>
    )
  }
  if (scene !== null) {
    return (
      <p className="stage-cue" data-scene="on">
        <SceneStamp {...scene} />
        {scene.text}
      </p>
    )
  }
  if (text === null || text.trim() === '') return null
  return <p className="stage-cue">{text}</p>
}
