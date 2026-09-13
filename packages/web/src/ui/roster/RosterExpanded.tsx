import { BOND_LEVEL_LABEL, SECTION_EMPTY, SECTION_TITLE, type Becoming } from './expand.js'

// The list stays mounted behind the expansion, so the way back is the row the viewer just
// clicked.

function Section({
  name,
  empty,
  children,
}: {
  name: keyof Becoming
  empty: boolean
  children?: React.ReactNode
}) {
  return (
    <section className="rx-block" data-section={name}>
      <h3 className="rx-title">{SECTION_TITLE[name]}</h3>
      {empty ? <p className="rx-empty">{SECTION_EMPTY[name]}</p> : children}
    </section>
  )
}

export function RosterExpanded({
  id,
  becoming,
  onOpenFull,
}: {
  id: string
  becoming: Becoming
  onOpenFull: () => void
}) {
  const b = becoming
  return (
    <div id={id} className="roster-expanded" role="group" aria-label="Who they have become">
      <p className="rx-lived">{b.lived}</p>

      <Section name="done" empty={b.done.length === 0}>
        <ul className="rx-list">
          {b.done.map((d) => (
            <li key={`${d.day}:${d.words}`}>
              <span className="stamp">Day {d.day}</span> {d.words}
            </li>
          ))}
        </ul>
      </Section>

      <Section name="knows" empty={b.knows.length === 0}>
        <ul className="rx-list">
          {b.knows.map((k) => (
            <li key={k.id}>
              <span className="rx-level">{BOND_LEVEL_LABEL[k.level]}</span> {k.words}
            </li>
          ))}
        </ul>
      </Section>

      <Section name="good" empty={b.good.length === 0}>
        <ul className="rx-list">
          {b.good.map((g) => (
            <li key={g.words}>{g.words}</li>
          ))}
        </ul>
      </Section>

      <Section name="changed" empty={b.changed.length === 0}>
        <ul className="rx-list">
          {b.changed.map((c) => (
            <li key={`${c.day}:${c.words}`}>
              <span className="stamp">Day {c.day}</span> {c.words}
            </li>
          ))}
        </ul>
      </Section>

      <button type="button" className="rx-full" onClick={onOpenFull}>
        Open their whole page
      </button>
    </div>
  )
}
