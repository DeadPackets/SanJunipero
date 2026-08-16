import { tickToMoment, type Bond } from '@sj/shared'
import { BOND_COLORS, BOND_KIND_LABEL, bondTooltip, type PeopleIndex } from './bondsModel.js'

export const BAR_MIN_PCT = 6   // a single shared moment still draws a visible mark

const moment = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}

// What passed between two people, in the order it passed. The bar counts shared moments — it
// measures a history, it does not fill toward anything, and nothing here can be won.
export function BondDetailPanel({ bond, people, maxStrength, onClose }: {
  bond: Bond
  people: PeopleIndex
  maxStrength: number
  onClose: () => void
}) {
  const pct = Math.max(BAR_MIN_PCT, Math.round((bond.strength / Math.max(1, maxStrength)) * 100))
  const shared = `${bond.strength} shared ${bond.strength === 1 ? 'moment' : 'moments'}`
  const newestFirst = [...bond.history].reverse()

  return (
    <aside className="bond-detail" role="dialog" aria-label={bondTooltip(bond, people)}>
      <header className="bond-head">
        {/* the kind's colour rides a swatch, never the label's own background: six tie
            colours cannot all clear AA under text, and the word carries the meaning anyway */}
        <span className="bond-kind">
          <span className="legend-swatch" style={{ background: BOND_COLORS[bond.kind] }} aria-hidden="true" />
          {BOND_KIND_LABEL[bond.kind]}
        </span>
        <h3 className="bond-title">{bondTooltip(bond, people)}</h3>
        <button className="bond-close" onClick={onClose} aria-label="Close this bond">×</button>
      </header>

      <div
        className="bond-bar"
        role="img"
        aria-label={`${shared}, out of ${maxStrength} for the closest pair in town`}
      >
        <span className="bond-bar-fill" style={{ width: `${pct}%`, background: BOND_COLORS[bond.kind] }} />
      </div>
      <p className="bond-count">{shared}</p>

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
