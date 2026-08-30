export function DirectorCue({ text }: { text: string | null }) {
  if (text === null || text.trim() === '') return null
  return <p className="stage-cue">{text}</p>
}
