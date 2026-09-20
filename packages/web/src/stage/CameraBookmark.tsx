import { useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { GameIcon } from '../paper/game/shared.js'

export function CameraBookmark({
  store,
  autoCut,
  following,
  cast,
  replaying,
  handbackAt,
  onRelease,
  onStart,
}: {
  store: WorldStore
  autoCut: boolean
  following: string | null
  cast: readonly string[]
  replaying: boolean
  handbackAt: () => number | null
  onRelease: () => void
  onStart: () => void
}) {
  const state =
    following !== null ? 'following' : replaying ? 'replay' : autoCut ? 'director' : 'free'
  const readNames = (): string => {
    const agents = store.getState()?.agents
    const ids = following === null ? cast : [following]
    const names = ids.map((id) => agents?.[id]?.name).filter((name) => name !== undefined)
    return names.length > 2 ? `${names[0]} + ${names.length - 1}` : names.join(' & ')
  }
  const names = useSyncExternalStore(store.subscribe, readNames, readNames)
  const label = {
    following: 'Following',
    replay: 'Replay',
    director: 'Director',
    free: 'Free camera',
  }[state]
  const action = {
    following: 'Stop',
    replay: 'Release',
    director: 'Pause',
    free: 'Start director',
  }[state]
  const subject = state === 'free' ? (handbackAt() === null ? '' : 'Auto resumes') : names
  return (
    <div className="camera-bookmark" data-state={state} aria-label="Camera control">
      <GameIcon kind="compass" />
      <span className="camera-bookmark-mode">{label}</span>
      {subject !== '' && (
        <>
          <span className="camera-bookmark-divider" aria-hidden="true">
            ·
          </span>
          <strong title={subject}>{subject}</strong>
        </>
      )}
      <button
        type="button"
        aria-label={
          state === 'following'
            ? `Stop following ${names}`
            : state === 'director'
              ? 'Pause director'
              : state === 'replay'
                ? 'Release replay camera'
                : 'Start director'
        }
        onClick={state === 'free' ? onStart : onRelease}
      >
        {action}
      </button>
    </div>
  )
}
