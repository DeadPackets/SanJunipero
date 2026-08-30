import { OUT_OF_REACH } from './townStats.js'

/** What a page shows where an empty state would lie: the wire dropped, and the town is not the
 *  one being quiet. `.feed-tab` is the sheet's own control, so the way back wears a real button. */
export function OutOfReach({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="out-of-reach">
      <p className="sheet-note">{OUT_OF_REACH.says}</p>
      <button type="button" className="feed-tab" onClick={onRetry}>
        {OUT_OF_REACH.again}
      </button>
    </div>
  )
}
