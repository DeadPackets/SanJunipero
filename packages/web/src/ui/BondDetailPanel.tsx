import { tickToMoment, type Bond } from '@sj/shared'
import {
  BOND_LEVEL_WORD, BOND_TYPE_WORD, partnerEvidence, type BondArc, type BondLevel, type BondType,
} from './bondModel2.js'
import { ARC_COLOR } from './relationGraph.js'
import type { PeopleIndex } from './bondsModel.js'

// WHAT PASSED BETWEEN TWO PEOPLE, in the order it passed.
//
// THE BAR IS GONE. It filled toward the closest pair in town, which makes a relationship into a
// meter with a leader (P3). The level word plus the dated history says strictly more, and it
// can go DOWN — which the bar could not express at all.

const moment = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}

const ARC_WORD: Readonly<Record<BondArc['direction'], string>> = {
  warming: 'Getting closer', cooling: 'Drifting apart', steady: 'Holding steady',
}

export function BondDetailPanel({ bond, people, type, level, arc, words, onClose }: {
  bond: Bond
  people: PeopleIndex
  type: BondType
  level: BondLevel
  arc: BondArc
  /** the `relationLine` sentence the graph already built — one sentence, one author */
  words: string
  onClose: () => void
}) {
  const newestFirst = [...bond.history].reverse()
  const evidence = type === 'partner' ? partnerEvidence(bond) : null
  const nameOf = (id: string): string => people[id]?.name ?? id

  return (
    <aside className="bond-detail" role="dialog" aria-label={words}>
      <header className="bond-head">
        <span className="bond-level">{BOND_LEVEL_WORD[level]}</span>
        {type !== 'none' && <span className="bond-type">{BOND_TYPE_WORD[type]}</span>}
        <h3 className="bond-title">{nameOf(bond.aId)} &amp; {nameOf(bond.bId)}</h3>
        <button className="bond-close" onClick={onClose} aria-label="Close this bond">×</button>
      </header>

      <p className="bond-line">{words}</p>

      {/* the arc is the thing the landed panel could not say at all */}
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
        <dd>{moment(bond.formedTick)}</dd>
        <dt>Last</dt>
        <dd>{moment(bond.lastUpdatedTick)}</dd>
      </dl>

      <ol className="bond-history">
        {newestFirst.map((h, i) => (
          <li key={`${h.tick}:${i}`}>
            <span className="stamp">{moment(h.tick)}</span>
            <span className="feed-text">They {h.note}.</span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
