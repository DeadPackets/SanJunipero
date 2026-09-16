import { useRef, useState, useSyncExternalStore } from 'react'
import {
  DEFAULT_CONFIG,
  isHearthKind,
  kindWords,
  roomCapacity,
  structureTitle,
  verbPhraseGerund,
} from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { GameIcon, Portrait } from '../paper/game/shared.js'

export function InteriorHUD({
  store,
  id,
  onExit,
  onPerson,
}: {
  store: WorldStore
  id: string
  onExit: () => void
  onPerson: (id: string) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [contents, setContents] = useState(false)
  const contentsButton = useRef<HTMLButtonElement>(null)
  const building = state?.structures[id]
  if (!state || !building) return null
  const occupants = Object.values(state.agents)
    .filter((a) => a.alive && a.insideId === id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const items = Object.values(state.items).filter((i) => i.loc.t === 'structure' && i.loc.id === id)
  const stacks = new Map<string, number>()
  for (const item of items) stacks.set(item.kind, (stacks.get(item.kind) ?? 0) + item.qty)
  const hearth = isHearthKind(store.getConfig() ?? DEFAULT_CONFIG, building.kind)
  const lit = (building.fueledUntilTick ?? 0) > state.tick
  return (
    <section
      className="interior-hud"
      aria-label="Inside this building"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && contents) {
          event.stopPropagation()
          setContents(false)
          contentsButton.current?.focus()
        }
      }}
    >
      <div className="interior-heading">
        <button type="button" className="interior-back" onClick={onExit}>
          <span aria-hidden="true">←</span>
          <span>Town</span>
        </button>
        <div className="interior-title">
          <h2>{structureTitle(building)}</h2>
          <p>
            {occupants.length} of {roomCapacity(building)} places occupied
            {hearth && (
              <span className={lit ? 'interior-warm' : 'interior-cold'}>
                {' '}
                · {lit ? 'Hearth burning' : 'Hearth cold'}
              </span>
            )}
          </p>
        </div>
        <div className="interior-residents" aria-label="People here">
          {occupants.length === 0 ? (
            <p className="interior-empty">Nobody is inside right now.</p>
          ) : (
            occupants.map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => onPerson(a.id)}
                aria-label={`${a.name}, ${a.asleep ? 'asleep' : a.activity ? verbPhraseGerund(a.activity.verb) : 'awake'}. Open profile`}
              >
                <Portrait store={store} id={a.id} size={36} />
                <span>
                  <strong>{a.name}</strong>
                  <span>
                    {a.asleep
                      ? 'Sleeping'
                      : a.activity
                        ? verbPhraseGerund(a.activity.verb)
                        : 'Awake'}
                  </span>
                </span>
                {a.asleep && <GameIcon kind="moon" />}
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className="interior-contents-button"
          ref={contentsButton}
          aria-expanded={contents}
          aria-label={`Belongings, ${items.reduce((sum, item) => sum + item.qty, 0)} items`}
          aria-controls="interior-contents"
          onClick={() => setContents((v) => !v)}
        >
          <GameIcon kind="note" />
          <span>Belongings</span>
          <span className="interior-count">{items.reduce((sum, item) => sum + item.qty, 0)}</span>
        </button>
      </div>
      {contents && (
        <div id="interior-contents" className="interior-contents">
          <div>
            <h3>Kept here</h3>
            <button type="button" aria-label="Close belongings" onClick={() => setContents(false)}>
              ×
            </button>
          </div>
          {stacks.size === 0 ? (
            <p>Nothing is stored here yet.</p>
          ) : (
            <ul>
              {[...stacks]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([kind, qty]) => (
                  <li key={kind}>
                    <span>{kindWords(kind)}</span>
                    <span>× {qty}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
