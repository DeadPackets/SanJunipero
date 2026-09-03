// The narrator has already written the day, and every paragraph of it cites the events it was
// written from. A replay that walks those events can caption itself in the town's own published
// voice — prose it has already paid for, at zero calls and zero lag.
//
// NEVER a per-view call. It scales with viewers rather than with residents: a hundred views of
// one moment is a hundred calls, and 3–10 s of lag on a thing that has to start now.

/** One day's chapter as `/api/chapters` serves it: prose with the `Seen:` footnotes taken out,
 *  and the seqs they carried, one list per paragraph. */
export type Chapter = { day: number; title: string; text: string; seen?: number[][] }

export type ChapterIndex = ReadonlyMap<number, string>

/** Every cited seq to the paragraph that cites it. First citation wins: a seq named by two
 *  paragraphs belongs to the one that reached for it first, and the alternative is a caption
 *  that changes under the reader for the same event. */
export function chapterIndex(chapters: readonly Chapter[]): ChapterIndex {
  const out = new Map<number, string>()
  for (const c of chapters) {
    const paras = c.text.split(/\n{2,}/)
    c.seen?.forEach((seqs, i) => {
      const text = paras[i]?.trim()
      if (text === undefined || text === '') return
      for (const seq of seqs) if (!out.has(seq)) out.set(seq, text)
    })
  }
  return out
}

/** The paragraph this run of events was written about, or null. One caption per batch: two
 *  paragraphs arriving in the same frame is one of them never read. */
export function captionFor(index: ChapterIndex, events: readonly { seq: number }[]): string | null {
  for (const ev of events) {
    const text = index.get(ev.seq)
    if (text !== undefined) return text
  }
  return null
}
