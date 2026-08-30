import { bondNote, tickToMoment, type Bond } from '@sj/shared'
import {
  BOND_LEVEL_WORD,
  BOND_TYPE_WORD,
  partnerEvidence,
  type BondArc,
  type BondLevel,
  type BondType,
  type PeopleIndex,
} from '../../ui/bondModel2.js'
import { ARC_COLOR } from '../../ui/relationGraph.js'
import { momentStamp } from '../stamp.js'

const ARC_WORD: Readonly<Record<BondArc['direction'], string>> = {
  warming: 'Getting closer',
  cooling: 'Drifting apart',
  steady: 'Holding steady',
}

/** What an open panel becomes when its tie leaves the feed. The panel is gone either way, so it
 *  says which of the two happened rather than shutting itself under the reader. */
export function FadedBond({ onClose }: { onClose: () => void }) {
  return (
    <aside className="bond-detail" role="group" aria-label="This bond has faded">
      <header className="bond-head">
        <h3 className="bond-title">This bond has faded</h3>
        <button type="button" className="bond-close" onClick={onClose} aria-label="Close this bond">
          ×
        </button>
      </header>
      <p className="bond-line">It has dropped out of the town’s ties since you opened it.</p>
    </aside>
  )
}

/** One tie, opened. The bar is gone: it filled toward the closest pair in town, which makes a
 *  relationship a meter with a leader. The level word plus the dated history can also go DOWN. */
export function BondDetail({
  bond,
  people,
  type,
  level,
  arc,
  words,
  onClose,
}: {
  bond: Bond
  people: PeopleIndex
  type: BondType
  level: BondLevel
  arc: BondArc
  /** the `relationLine` sentence the graph already built — one sentence, one author */
  words: string
  onClose: () => void
}) {
  const newestFirst = [...bond.recent].reverse()
  const evidence = type === 'partner' ? partnerEvidence(bond) : null
  const nameOf = (id: string): string => people[id]?.name ?? id
  const earlier = bond.strength - bond.recent.length

  return (
    <aside className="bond-detail" role="group" aria-label={words}>
      <header className="bond-head">
        <span className="bond-level">{BOND_LEVEL_WORD[level]}</span>
        {type !== 'none' && <span className="bond-type">{BOND_TYPE_WORD[type]}</span>}
        <h3 className="bond-title">
          {nameOf(bond.aId)} &amp; {nameOf(bond.bId)}
        </h3>
        <button type="button" className="bond-close" onClick={onClose} aria-label="Close this bond">
          ×
        </button>
      </header>

      <p className="bond-line">{words}</p>

      <p className="bond-arc">
        <span
          className="bond-arc-mark"
          style={{ background: ARC_COLOR[arc.direction] }}
          aria-hidden="true"
        />
        {ARC_WORD[arc.direction]}
        {arc.direction !== 'steady' && ` since Day ${arc.sinceDay}`}
      </p>

      {evidence !== null && <p className="bond-evidence">{evidence}</p>}

      <dl className="bond-dates">
        <dt>First</dt>
        <dd>{momentStamp(bond.formedTick)}</dd>
        <dt>Last</dt>
        <dd>{momentStamp(bond.lastUpdatedTick)}</dd>
      </dl>

      {/* The counts are the whole history; the column below is the last few acts of it. */}
      <ul className="bond-tally">
        {bond.acts.map((a) => (
          <li key={a.kind}>
            <span className="tally-count">{a.count.toLocaleString()}×</span>
            <span className="feed-text">
              They {bondNote(a.kind)}, first on Day {tickToMoment(a.firstTick).day}.
            </span>
          </li>
        ))}
      </ul>

      <ol className="bond-history">
        {newestFirst.map((h, i) => (
          <li key={`${h.tick}:${i}`}>
            <span className="stamp">{momentStamp(h.tick)}</span>
            <span className="feed-text">They {bondNote(h.kind)}.</span>
          </li>
        ))}
      </ol>

      {earlier > 0 && (
        <p className="bond-earlier">
          {earlier === 1
            ? 'One earlier time is counted above.'
            : `${earlier.toLocaleString()} earlier times are counted above.`}
        </p>
      )}
    </aside>
  )
}
