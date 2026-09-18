import { useEffect, useRef, useState } from 'react'
import { agentName } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { SceneStage } from '../ui/stageCue.js'
import { GameIcon } from '../paper/game/shared.js'

type Turn = { seq: number; sceneId: string; agentId: string; text: string }

export function LivingScene({ store, stage }: { store: WorldStore; stage: SceneStage | null }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let tick = store.getTick(),
      live = store.getMode().live
    const offStore = store.subscribe(() => {
      const nextTick = store.getTick(),
        nextLive = store.getMode().live
      if (nextTick < tick || live !== nextLive) {
        setTurns([])
        dialog.current?.close()
      }
      tick = nextTick
      live = nextLive
    })
    const offEvents = store.onEvents((events) => {
      const lines = events
        .filter((ev) => ev.type === 'scene_line')
        .map((ev) => {
          const p = ev.payload as { id: string; agentId: string; text: string }
          return { seq: ev.seq, sceneId: p.id, agentId: p.agentId, text: p.text }
        })
      if (lines.length) setTurns((was) => [...was, ...lines].slice(-200))
    })
    return () => {
      offStore()
      offEvents()
    }
  }, [store])
  useEffect(() => {
    dialog.current?.close()
  }, [stage?.scene.id])
  if (!stage) return null
  const scene = stage.scene
  const lines = turns.filter((line) => line.sceneId === scene.id)
  const names = scene.participants.map((id) => agentName(store.getState()?.agents, id)).join(' & ')
  return (
    <>
      <div className="living-scene" data-ended={stage.phase === 'summary'}>
        <GameIcon kind={stage.phase === 'summary' ? 'note' : 'people'} />
        {stage.phase === 'summary' ? <p>{scene.summary}</p> : <span>{names}</span>}
        <button type="button" onClick={() => dialog.current?.showModal()}>
          Read conversation
        </button>
      </div>
      <dialog ref={dialog} className="living-transcript" aria-labelledby="living-transcript-title">
        <header>
          <GameIcon kind="chronicle" />
          <h2 id="living-transcript-title">
            {scene.topic === ''
              ? 'A conversation in town'
              : (scene.topic ?? 'A conversation in town')}
          </h2>
          <button
            type="button"
            aria-label="Close conversation"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <p className="transcript-note">
          Public lines received during this visit. Earlier turns may not be available.
        </p>
        {lines.length ? (
          <ol>
            {lines.map((line) => (
              <li key={line.seq}>
                <strong>{agentName(store.getState()?.agents, line.agentId)}</strong>
                <p>{line.text}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="transcript-note">Waiting for the next spoken turn.</p>
        )}
        {stage.phase === 'summary' && <p className="transcript-note">{scene.summary}</p>}
      </dialog>
    </>
  )
}
