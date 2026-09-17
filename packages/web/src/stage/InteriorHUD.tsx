import { useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONFIG, isHearthKind, kindWords, roomCapacity, structureTitle } from '@sj/shared'
import { roomStateOf } from '../ui/interiorModel.js'
import type { WorldStore } from '../state/worldStore.js'
import { GameIcon, Portrait } from '../paper/game/shared.js'
import { resolveAssetId } from '../render/textures.js'

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
  useSyncExternalStore(store.subscribe, store.assetsSeq)
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
        <button type="button" className="interior-back" aria-label="Back to town" onClick={onExit}>
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
                aria-label={`${a.name}, ${roomStateOf(a, state.agents)}. Open profile`}
              >
                <Portrait store={store} id={a.id} size={36} />
                <span>
                  <strong>{a.name}</strong>
                  <span>{roomStateOf(a, state.agents)}</span>
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
          <div className="interior-contents-title">
            <h3>
              <GameIcon kind="note" /> Belongings
            </h3>
            <button type="button" aria-label="Close belongings" onClick={() => setContents(false)}>
              ×
            </button>
          </div>
          <p className="interior-contents-summary">
            {stacks.size} kinds · {items.reduce((sum, item) => sum + item.qty, 0)} items kept here
          </p>
          {stacks.size === 0 ? (
            <p className="interior-contents-empty">
              <GameIcon kind="note" />
              Nothing is stored here yet.
            </p>
          ) : (
            <ul>
              {[...stacks]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([kind, qty]) => {
                  const asset = resolveAssetId(store.assetRecords(), 'item', `${kind}#icon`)
                  const family = /wood|stone|iron|ore|clay|plank|fiber/.test(kind)
                    ? 'materials'
                    : /bread|berry|fruit|fish|grain|wheat|herb|water|food/.test(kind)
                      ? 'provisions'
                      : /axe|pick|hoe|knife|hammer|tool/.test(kind)
                        ? 'tools'
                        : 'other'
                  return (
                    <li key={kind} data-family={family}>
                      <span className="interior-item-art" aria-hidden="true">
                        {asset ? (
                          <img src={`/assets/${asset}.png`} alt="" />
                        ) : (
                          <GameIcon kind={family === 'tools' ? 'hammer' : 'note'} />
                        )}
                      </span>
                      <span className="interior-item-name">{kindWords(kind)}</span>
                      <span
                        className="interior-item-qty"
                        aria-label={`${qty} ${qty === 1 ? 'item' : 'items'}`}
                      >
                        ×{qty}
                      </span>
                    </li>
                  )
                })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
