import {
  DOCKABLE,
  DOCKABLE_LABEL,
  HUD_PEEK_PX,
  HUD_TOGGLE_KEY,
  SLOTS_FOR,
  SLOT_LABEL,
  hiddenCount,
  isFullyHidden,
  type HudEv,
  type HudLayout,
} from './hudLayout.js'

// Hiding is only safe if it is reversible without knowing a keyboard shortcut, so the grab
// handle is a real button with a spoken label and is never itself hideable.

export function HudDock({
  layout,
  open,
  onEvent,
  onOpen,
}: {
  layout: HudLayout
  open: boolean
  onEvent: (ev: HudEv) => void
  onOpen: (open: boolean) => void
}) {
  const away = hiddenCount(layout)
  const all = isFullyHidden(layout)
  const handleLabel = open
    ? 'Close the controls menu'
    : all
      ? `Bring the controls back (or press ${HUD_TOGGLE_KEY.toUpperCase()})`
      : away > 0
        ? `Move or hide the controls — ${away} put away`
        : 'Move or hide the controls'

  return (
    <div
      className={open ? 'hud-dock open' : 'hud-dock'}
      style={{ '--hud-peek': `${HUD_PEEK_PX}px` } as React.CSSProperties}
    >
      <button
        type="button"
        className="hud-handle"
        aria-label={handleLabel}
        aria-expanded={open}
        title={handleLabel}
        onClick={() => onOpen(!open)}
      >
        <span className="hud-grip" aria-hidden="true" />
      </button>

      {open && (
        <div className="hud-menu" role="group" aria-label="Where the controls sit">
          {DOCKABLE.map((what) => (
            <div className="hud-row" key={what}>
              <span className="hud-row-name">{DOCKABLE_LABEL[what]}</span>
              <span className="hud-slots">
                {SLOTS_FOR[what].map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className="hud-slot"
                    data-dock={`${what}:${slot}`}
                    aria-label={`${DOCKABLE_LABEL[what]}: ${SLOT_LABEL[slot]}`}
                    aria-pressed={layout[what] === slot}
                    onClick={() => onEvent({ kind: 'dock', what, to: slot })}
                  >
                    {SLOT_LABEL[slot]}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <div className="hud-row hud-row-wide">
            <button
              type="button"
              className="hud-slot"
              aria-label={all ? 'Bring everything back' : 'Put everything away'}
              onClick={() => onEvent({ kind: all ? 'show-all' : 'hide-all' })}
            >
              {all ? 'Bring everything back' : 'Put everything away'}
            </button>
            <button
              type="button"
              className="hud-slot"
              aria-label="Put the controls back where they started"
              onClick={() => onEvent({ kind: 'reset' })}
            >
              Back to the start
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
