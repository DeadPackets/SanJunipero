import { KEY_MAP_ID } from './KeyMap.js'

export function HelpButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="help-button"
      aria-haspopup="dialog"
      aria-controls={KEY_MAP_ID}
      aria-expanded={open}
      aria-label="Help and shortcuts"
      onClick={onToggle}
    >
      <span className="control-icon control-icon-help" aria-hidden="true" />
      <span className="control-tip" aria-hidden="true">
        Help &amp; shortcuts
      </span>
    </button>
  )
}
