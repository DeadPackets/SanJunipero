import type { ThoughtsSetting } from '../ui/thoughts.js'

export function ThoughtsButton({
  thoughts,
  onToggle,
}: {
  thoughts: ThoughtsSetting
  onToggle: () => void
}) {
  const shown = thoughts === 'shown'
  return (
    <button
      type="button"
      className="thoughts-button"
      aria-pressed={shown}
      aria-label="Thought bubbles"
      onClick={onToggle}
    >
      <span className="control-icon control-icon-thoughts" aria-hidden="true" />
      {!shown && (
        <span className="control-off" aria-hidden="true">
          OFF
        </span>
      )}
      <span className="control-tip" aria-hidden="true">
        Thoughts {shown ? 'on' : 'off'}
      </span>
    </button>
  )
}
