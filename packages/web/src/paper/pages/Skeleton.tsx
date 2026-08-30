/** `aria-busy` on a role-less div exposes no busy state at all, so the shape is a status
 *  region and says the word once. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="stage-sr">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}
