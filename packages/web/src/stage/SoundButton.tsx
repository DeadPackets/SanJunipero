import type { SoundSetting } from '../ui/sound.js'

export function SoundButton({
  setting,
  onToggle,
}: {
  setting: SoundSetting
  onToggle: () => void
}) {
  const on = setting === 'on'
  return (
    <button
      type="button"
      className="sound-button"
      aria-pressed={on}
      aria-label="Town sound"
      onClick={onToggle}
    >
      <span className="control-icon control-icon-sound" aria-hidden="true" />
      {!on && (
        <span className="control-off" aria-hidden="true">
          OFF
        </span>
      )}
      <span className="control-tip" aria-hidden="true">
        Sound {on ? 'on' : 'off'}
      </span>
    </button>
  )
}
