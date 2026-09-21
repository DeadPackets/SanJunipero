import { useEffect, useRef } from 'react'
import { PublicUsageSchema } from '@sj/shared'
import { endpoint, useFeed } from '../ui/useEndpoint.js'
import { GameIcon } from '../paper/game/shared.js'
import { usageLabel, usageMoney } from './usageModel.js'
import { stageInputBlocked } from './useStageKeys.js'
import './usage-meter.css'

const usageFeed = endpoint(
  '/api/usage',
  (body) => {
    const parsed = PublicUsageSchema.safeParse(body)
    return parsed.success ? parsed.data : null
  },
  15_000,
)

export function UsageMeter() {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const outside = (event: Event) => {
      if (
        details.current?.open &&
        !stageInputBlocked() &&
        !details.current.contains(event.target as Node)
      )
        details.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        !details.current?.open ||
        stageInputBlocked() ||
        document.querySelector('.key-map:not([hidden])')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      details.current.open = false
      details.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  const read = useFeed(usageFeed)
  const usage = read.failed ? null : read.data
  const known = usage && usage.mode !== 'unavailable' ? usage : null
  return (
    <details className="usage-meter" ref={details}>
      <summary aria-label={`AI usage: ${read.loaded ? usageLabel(usage, read.failed) : 'loading'}`}>
        {read.loaded ? usageLabel(usage, read.failed) : 'Loading usage…'}
      </summary>
      <div className="usage-meter-paper">
        <h3>
          <GameIcon kind="note" /> Town usage
        </h3>
        {known ? (
          <>
            <p role="status">
              {known.mindStatus === 'budget-stopped'
                ? 'Minds are paused at the spending limit. The town clock can still move.'
                : known.mindStatus === 'delayed'
                  ? 'AI responses are delayed. Residents may wait before choosing their next action.'
                  : known.mindStatus === 'active'
                    ? 'AI minds are active.'
                    : 'AI minds are disabled.'}
            </p>
            <p>
              {known.mode === 'scripted'
                ? 'Scripted preview. No AI calls are being made.'
                : 'Recorded AI and art spending, shared with everyone watching.'}
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Last 24h</th>
                  <th scope="col">All time</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Cost</th>
                  <td>{usageMoney(known.last24h.usd)}</td>
                  <td>{usageMoney(known.total.usd)}</td>
                </tr>
                <tr>
                  <th scope="row">Calls</th>
                  <td>{known.last24h.calls.toLocaleString()}</td>
                  <td>{known.total.calls.toLocaleString()}</td>
                </tr>
                <tr>
                  <th scope="row">Input tokens</th>
                  <td>{known.last24h.inputTokens.toLocaleString()}</td>
                  <td>{known.total.inputTokens.toLocaleString()}</td>
                </tr>
                <tr>
                  <th scope="row">Output tokens</th>
                  <td>{known.last24h.outputTokens.toLocaleString()}</td>
                  <td>{known.total.outputTokens.toLocaleString()}</td>
                </tr>
                <tr>
                  <th scope="row">Cached input</th>
                  <td>{known.last24h.cachedInputTokens.toLocaleString()}</td>
                  <td>{known.total.cachedInputTokens.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <p className="usage-meter-note">
              Cached tokens are part of input. Reasoning tokens are part of output. All time follows
              the saved ledger, including restarts.
            </p>
          </>
        ) : (
          <p>Usage cannot be read right now. These totals are unavailable, not zero.</p>
        )}
      </div>
    </details>
  )
}
