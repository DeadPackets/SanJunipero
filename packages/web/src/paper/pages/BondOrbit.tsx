import { BOND_LEVEL_WORD } from '../../ui/bondModel2.js'
import { ORBIT_R, ORBIT_RINGS, type Orbit, type OrbitTie } from '../../ui/bondOrbit.js'

/** A doubled stroke is the second family channel; the pair is offset by its own width. */
const DOUBLE_GAP = 1.6
/** Orbit units to a percentage of the box, so a node lands on the end of its own spoke. */
const pct = (v: number): string => `${((v + ORBIT_R) / (ORBIT_R * 2)) * 100}%`

function Tie({ tie }: { tie: OrbitTie }) {
  if (!tie.drawn) return null
  // Perpendicular to the spoke, so a doubled line reads as two rails at any angle.
  const len = Math.hypot(tie.x, tie.y) || 1
  const [nx, ny] = [-tie.y / len, tie.x / len]
  const offsets = tie.strokeCount === 2 ? [-1, 1].map((s) => s * (tie.width / 2 + DOUBLE_GAP)) : [0]
  return (
    <>
      {offsets.map((o) => (
        <line
          key={o}
          x1={nx * o}
          y1={ny * o}
          x2={tie.x + nx * o}
          y2={tie.y + ny * o}
          stroke={tie.color}
          strokeWidth={tie.width}
          strokeDasharray={tie.dash === null ? undefined : tie.dash.map((d) => d * 3).join(' ')}
        />
      ))}
    </>
  )
}

/** ★ THE ORBIT — ego-centric, and the rings are the graph's own `LEVEL_DISTANCE`, so distance
 *  here is the number the town picture is laid out with rather than a drawing. Each spoke carries
 *  all three detail channels at once: the dash is the family tie, the colour is which way it is
 *  going, and the weight is how much of it there is.
 *
 *  The rings and the spokes scale with the box; the NAMES do not. A glyph inside the viewBox
 *  would be 10px on a 300px phone, and nothing in this product renders below twelve. */
export function BondOrbit({ orbit, onCentre }: { orbit: Orbit; onCentre: (id: string) => void }) {
  const box = ORBIT_R
  return (
    <div className="orbit">
      <div
        className="orbit-plot"
        role="img"
        aria-label={`${orbit.name}, and everyone else in the town: ${String(orbit.ties.length)} people, nearer meaning closer`}
      >
        <svg
          className="orbit-lines"
          viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}
          aria-hidden="true"
        >
          {ORBIT_RINGS.map((ring) => (
            <circle key={ring.level} className="orbit-ring" r={ring.r} />
          ))}
          {orbit.ties.map((tie) => (
            <Tie key={tie.id} tie={tie} />
          ))}
        </svg>
        {orbit.ties.map((tie) => (
          <span
            key={tie.id}
            className="orbit-mark"
            style={{ left: pct(tie.x), top: pct(tie.y) }}
            aria-hidden="true"
          >
            <i className="orbit-node" />
            <b className="orbit-name">{tie.name}</b>
          </span>
        ))}
        <span
          className="orbit-mark orbit-me"
          style={{ left: '50%', top: '50%' }}
          aria-hidden="true"
        >
          <i className="orbit-node" />
          <b className="orbit-name">{orbit.name}</b>
        </span>
      </div>
      {/* The picture is the answer; this is the keyboard's way through it and its text
          alternative in one list, the same bargain the town graph's roll makes. */}
      <ul className="stage-sr" aria-label={`Everyone ${orbit.name} knows`}>
        {orbit.ties.map((tie) => (
          <li key={tie.id}>
            <button
              type="button"
              onClick={() => {
                onCentre(tie.id)
              }}
            >
              {tie.words} Open {tie.name}’s orbit.
            </button>
          </li>
        ))}
      </ul>
      <p className="orbit-key">
        <b>Nearer means closer.</b>{' '}
        {ORBIT_RINGS.map((r) => `${BOND_LEVEL_WORD[r.level].toLowerCase()} ${String(r.r)}`).join(
          ' · ',
        )}
        . No line means they have never met.
      </p>
    </div>
  )
}

/** A person whose ties the world has not written yet: an empty orbit is news, and it is not the
 *  same news as a graph that has not loaded. */
export function EmptyOrbit({ name }: { name: string }) {
  return <p className="feed-empty">{name} has met nobody the town has written down yet.</p>
}
