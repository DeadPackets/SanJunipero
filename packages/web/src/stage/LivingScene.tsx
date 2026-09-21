import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { agentName, ServerTranscript } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { SceneStage } from '../ui/stageCue.js'
import { GameIcon } from '../paper/game/shared.js'

export function LivingScene({ store, stage }: { store: WorldStore; stage: SceneStage | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const [failed, setFailed] = useState(false)
  const sceneId = stage?.scene.id ?? null
  const transcript = useSyncExternalStore(store.subscribe, () =>
    sceneId === null ? null : store.transcript(sceneId),
  )
  useEffect(() => {
    let tick = store.getTick(),
      live = store.getMode().live
    const off = store.subscribe(() => {
      const nextTick = store.getTick(),
        nextLive = store.getMode().live
      if (nextTick < tick || live !== nextLive) {
        request.current?.abort()
        dialog.current?.close()
      }
      tick = nextTick
      live = nextLive
    })
    return () => {
      off()
      request.current?.abort()
    }
  }, [store])
  useEffect(() => {
    request.current?.abort()
    dialog.current?.close()
  }, [sceneId])
  const openTranscript = async (): Promise<void> => {
    if (sceneId === null) return
    dialog.current?.showModal()
    setFailed(false)
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const response = await fetch(
        `/api/scenes/${encodeURIComponent(sceneId)}/transcript?atTick=${store.getTick()}`,
        { signal: controller.signal },
      )
      if (!response.ok) throw new Error('transcript unavailable')
      const frame = ServerTranscript.parse(await response.json())
      if (!controller.signal.aborted) store.applyServer(frame)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    }
  }
  if (!stage) return null
  const scene = stage.scene
  const lines = transcript?.lines ?? []
  const names = scene.participants.map((id) => agentName(store.getState()?.agents, id)).join(' & ')
  return (
    <>
      <div className="living-scene" data-ended={stage.phase === 'summary'}>
        <GameIcon kind={stage.phase === 'summary' ? 'note' : 'people'} />
        {stage.phase === 'summary' ? <p>{scene.summary}</p> : <span>{names}</span>}
        <button
          type="button"
          onClick={() => {
            void openTranscript()
          }}
        >
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
          {transcript?.truncated
            ? 'Showing the latest 100 spoken turns.'
            : 'Public words spoken in this conversation.'}
          {failed && ' Earlier turns could not load. Close and reopen to retry.'}
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
