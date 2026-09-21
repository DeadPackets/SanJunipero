import { PublicUsageSchema } from '@sj/shared'
import { endpoint, useFeed } from '../ui/useEndpoint.js'
import { GameIcon } from '../paper/game/shared.js'
import { usageLabel, usageMoney } from './usageModel.js'
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
  const read = useFeed(usageFeed)
  const usage = read.failed ? null : read.data
  const known = usage && usage.mode !== 'unavailable' ? usage : null
  return (
    <details className="usage-meter">
      <summary aria-label={`AI usage: ${read.loaded ? usageLabel(usage, read.failed) : 'loading'}`}>
        {read.loaded ? usageLabel(usage, read.failed) : 'Loading usage…'}
      </summary>
      <div className="usage-meter-paper">
        <h3>
          <GameIcon kind="note" /> Town usage
        </h3>
        {known ? (
          <>
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
