import { useEffect, useState } from 'react'
import { momentTitle } from '@sj/shared'
import { chronicleGlyph } from '../ui/importantFeed.js'
import { CUE_ICON_PX, STAKES_MAX, type SceneCue, type StageCue } from '../ui/stageCue.js'
import { type CueLine, type CueSlot, cueStep, NO_CUE_LINE } from './cueSlot.js'

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

/** The kind in the town's own words, struck like a stamp, with what is at stake measured along
 *  its foot. Two channels and one gesture: the ink says how hot and the rule says how hot. */
function SceneStamp({ kind, stakes, band }: SceneCue) {
  return (
    <span
      className="stage-scene-stamp"
      data-stakes={band}
      style={stakes === null ? undefined : { ['--stakes' as string]: stakes / STAKES_MAX }}
    >
      {momentTitle(kind, null)}
      {stakes !== null && (
        <span className="stage-sr">
          , {stakes} of {STAKES_MAX} at stake
        </span>
      )}
    </span>
  )
}

/** What the town is DOING: the scene it is in, else why the camera came, else what the shot is. */
type Doing = { scene: SceneCue } | { why: string } | { caption: string }

function doingLine(
  scene: SceneCue | null,
  why: string | null,
  text: string | null,
): CueLine<Doing> {
  if (scene !== null) return { key: scene.text, line: { scene } }
  if (why !== null && why.trim() !== '') return { key: why, line: { why } }
  if (text !== null && text.trim() !== '') return { key: text, line: { caption: text } }
  return NO_CUE_LINE
}

function useCueSlot<T>(next: CueLine<T>): CueLine<T> {
  const [slot, setSlot] = useState<CueSlot<T>>(() => ({ shown: next, until: 0, waiting: next }))
  if (next.key !== slot.waiting.key) setSlot((s) => cueStep(s, next, Date.now()))
  useEffect(() => {
    if (slot.waiting.key === slot.shown.key) return
    const timer = setTimeout(
      () => {
        setSlot((s) => cueStep(s, s.waiting, Date.now()))
      },
      Math.max(0, slot.until - Date.now()),
    )
    return () => {
      clearTimeout(timer)
    }
  }, [slot])
  return slot.shown.key === next.key ? next : slot.shown
}

/** Two slots, because news and the thing itself are two different answers: what just HAPPENED
 *  stands over what the town is DOING, and neither takes the line the other is standing on. */
export function DirectorCue({
  text,
  moment,
  scene,
  why = null,
}: {
  text: string | null
  moment: StageCue | null
  scene: SceneCue | null
  /** the director's own sentence for the shot it took, in the town's words */
  why?: string | null
}) {
  const news = useCueSlot<StageCue>(
    moment === null ? NO_CUE_LINE : { key: moment.text, line: moment },
  )
  const doing = useCueSlot<Doing>(doingLine(scene, why, text))
  const said = doing.line
  if (news.line === null && said === null) return null
  return (
    <p
      className="stage-cue"
      data-scene={said !== null && 'scene' in said ? 'on' : undefined}
      data-why={said !== null && 'why' in said ? 'on' : undefined}
    >
      {news.line !== null && (
        <span className="stage-cue-news">
          <CueGlyph icon={news.line.icon} />
          {news.line.text}
        </span>
      )}
      {said !== null && 'scene' in said && (
        <>
          <SceneStamp {...said.scene} />
          {said.scene.text}
        </>
      )}
      {said !== null && 'why' in said && said.why}
      {said !== null && 'caption' in said && said.caption}
    </p>
  )
}
