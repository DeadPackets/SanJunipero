import type { ChapterRow, HeatScores, Milestone, SceneSegment } from './types.js'

// Deterministic composition over the day's already-verified chapter — no second
// LLM call. scenes (optional, index-aligned with heats) supplies the top-heat
// scene's cast; the plan's 4-arg shape carried no cast source.
export function renderNewspaper(
  day: number,
  chapter: ChapterRow,
  heats: HeatScores[],
  milestones: Milestone[],
  scenes?: SceneSegment[],
): { headline: string; body: string; citations: number[] } {
  const parts: string[] = [chapter.text]

  const marks = milestones.filter((m) => m.day === day)
  if (marks.length > 0) {
    parts.push(['Marks of the day:', ...marks.map((m) => `- ${m.label}`)].join('\n'))
  }

  if (scenes !== undefined && scenes.length > 0 && heats.length > 0) {
    let top = 0
    heats.forEach((h, i) => {
      if (h.total > (heats[top]?.total ?? 0)) top = i
    })
    const cast = scenes[top]?.cast ?? []
    if (cast.length > 0) parts.push(`Seen in the thick of it: ${cast.join(', ')}.`)
  }

  return { headline: chapter.title, body: parts.join('\n\n'), citations: chapter.citations }
}
