import { CONDITION_WORD } from '../status.js'
import { MOOD_GLYPH_PX, MOOD_WORD, moodGlyph, type RosterRow2 } from './rosterRow.js'
import type { Expression } from '../../render/mood.js'

/** A 16-px face drawn at its own grid size read as a smudge in the corner: it needs the same 2× the
 *  control bar gives its 8-px glyphs. */
const MOOD_GLYPH_SCALE = 2

/** Decorative: the row's own label speaks the mood, so the glyph stays out of the
 *  accessibility tree instead of being read twice. */
function MoodGlyph({ mood }: { mood: Expression }) {
  return (
    <svg
      className="rr-mood"
      viewBox={`0 0 ${MOOD_GLYPH_PX} ${MOOD_GLYPH_PX}`}
      width={MOOD_GLYPH_PX * MOOD_GLYPH_SCALE}
      height={MOOD_GLYPH_PX * MOOD_GLYPH_SCALE}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {moodGlyph(mood).map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

function Portrait({ row }: { row: RosterRow2 }) {
  if ('url' in row.portrait) {
    return (
      <span
        className="rr-face"
        style={{ backgroundImage: `url("${row.portrait.url}")` }}
        aria-hidden="true"
      />
    )
  }
  if ('bust' in row.portrait) {
    return <span className="rr-face" style={row.portrait.bust} aria-hidden="true" />
  }
  return (
    <span className="rr-face rr-token" aria-hidden="true">
      {row.portrait.token}
    </span>
  )
}

/** Everything U12 asks a row to say, in one sentence, for someone who cannot see it. */
export function rowLabel(row: RosterRow2): string {
  const conds = row.conditions.map((c) => CONDITION_WORD[c].toLowerCase())
  const company = row.with.length === 0 ? 'alone' : `near ${row.with.join(' and ')}`
  return [
    `${row.name}, ${row.ageWords}`,
    row.state.toLowerCase(),
    ...conds,
    MOOD_WORD[row.mood],
    row.place.words,
    company,
  ].join(', ')
}

export function RosterRowView({
  row,
  open,
  onToggle,
}: {
  row: RosterRow2
  open: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={open ? 'roster-row open' : 'roster-row'}
      data-row={row.id}
      /* substance drives DENSITY, never a printed number (P3): a person the run has made
         something of gets a row with more room in it. */
      data-lived={row.substance >= 0.34 ? 'much' : row.substance > 0 ? 'some' : 'none'}
      aria-expanded={open}
      aria-label={rowLabel(row)}
      onClick={() => {
        onToggle(row.id)
      }}
    >
      <Portrait row={row} />
      <span className="rr-who">
        <span className="rr-name">{row.name}</span>
        <span className="rr-age">{row.ageWords}</span>
      </span>
      <span className="rr-doing">
        <span className="rr-state">{row.state}</span>
        {row.conditions.length > 0 && (
          <span className="rr-conds">
            {row.conditions.map((c) => (
              <span key={c} className={c === 'unwell' ? 'rr-cond ill' : 'rr-cond'}>
                {CONDITION_WORD[c]}
              </span>
            ))}
          </span>
        )}
      </span>
      <MoodGlyph mood={row.mood} />
      <span className="rr-place">{row.place.words}</span>
      {/* ★ "near", not "with". `row.with` is `companyOf` — who is inside earshot RIGHT NOW,
          which is a fact about where two bodies are standing and not a tie between them. It
          said "with Nadia" beside a nav tab labelled BONDS, and merge train 3 read the two as
          the same claim and filed the bond count as a lie. The count was right; the word was
          borrowed. Proximity and a bond are different things and the roster now says which. */}
      {row.with.length > 0 && <span className="rr-with">near {row.with.join(', ')}</span>}
    </button>
  )
}
