/** What the camera is looking at, said once at the foot of the picture — the caption a
 *  documentary puts under a shot, not a control. */
export function DirectorCue({ text }: { text: string }) {
  if (text.trim() === '') return null
  return (
    <p className="stage-cue" role="status">
      {text}
    </p>
  )
}
