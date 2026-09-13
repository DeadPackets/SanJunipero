import { useCallback, useEffect, useRef, useState } from 'react'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { momentStamp } from '../stamp.js'

/** Slow on purpose: these are numbers to watch, not to animate. */
const READ_EVERY_MS = 5000
/** `/admin/speed` takes anything between 0.1 and 60; these are the stops offered. */
export const SPEED_STOPS = [0.5, 1, 2, 4, 8] as const

export type ClockState = { paused: boolean; speed: number; tick: number }
type Spend = { calls: number; usd: number }
export type CostReport = {
  live: boolean
  today: Spend
  lifetime: Spend
  projection: { usdPerSimDay: number; windowRealMinutes: number; sampledCalls: number }
  byCaller: (Spend & { caller: string })[]
  byMind: (Spend & { agentId: string })[]
  cacheReadShare: number | null
  caps: { dailyUsd: number; lifetimeUsd: number }
  stop: { dailyReached: boolean; lifetimeReached: boolean }
  alerts: { ts: number; kind: string; detail: string }[]
  answerRate: {
    stated: number
    answered: number
    abandoned: number
    inFlight: number
    rate: number | null
    byVerb: { verb: string; stated: number; answered: number }[]
  }
}
export type PendingRuling = { id: number; ruleId: number; recipeId: string; tick: number }

/** Four places everywhere, so a column of dollars stays a column. */
export const usd = (n: number): string => `$${n.toFixed(4)}`
export const pct = (r: number | null): string => (r === null ? '—' : `${Math.round(r * 100)}%`)

async function ask<T>(
  fetchFn: typeof fetch,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T | { error: string }> {
  try {
    const res = await fetchFn(path, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    })
    const body: unknown = await res.json()
    if (!res.ok) {
      const said = (body as { error?: unknown }).error
      const because =
        res.status === 401 || res.status === 403
          ? 'the key was refused — check the operator token'
          : `the channel refused this (${res.status}) — try again`
      return { error: typeof said === 'string' ? said : because }
    }
    return body as T
  } catch {
    // `Failed to fetch` names neither the problem nor the way back.
    return { error: 'the operator channel did not answer — check it is running, then try again' }
  }
}

const failed = (r: unknown): r is { error: string } =>
  typeof r === 'object' && r !== null && 'error' in r

/** One read of the operator's channel, re-taken on `READ_EVERY_MS` and after every write. The
 *  refetch goes through a ref, not through the effect's deps: a write must not re-time the beat. */
function useAdminRead<T>(token: string, path: string): [T | null, () => void, boolean] {
  const [data, setData] = useState<T | null>(null)
  // A dropped read used to leave `data` null forever, so a broken channel wore the loading
  // sentence and never stopped saying it. The refusal is now its own answer.
  const [down, setDown] = useState(false)
  const alive = useRef(true)
  const read = useCallback(() => {
    void ask<T>(fetch, token, path).then((r) => {
      if (!alive.current) return
      if (failed(r)) {
        setDown(true)
        return
      }
      setDown(false)
      setData(r)
    })
  }, [token, path])
  useEffect(() => {
    alive.current = true
    read()
    const timer = setInterval(read, READ_EVERY_MS)
    return () => {
      alive.current = false
      clearInterval(timer)
    }
  }, [read])
  return [data, read, down]
}

export function ClockView({
  clock,
  onWrite,
}: {
  clock: ClockState
  onWrite: (path: string, body?: unknown) => void
}) {
  return (
    <section className="ops-block" aria-label="World clock">
      <h3 className="feed-head">Clock</h3>
      <p className="ops-reading">
        <span className={clock.paused ? 'ops-word stopped' : 'ops-word'}>
          {clock.paused ? 'Stopped' : 'Running'}
        </span>
        <span className="ops-at">{momentStamp(clock.tick)}</span>
      </p>
      <div className="ops-row">
        <button
          type="button"
          className="rx-full"
          onClick={() => {
            onWrite(clock.paused ? '/admin/resume' : '/admin/pause')
          }}
        >
          {clock.paused ? 'Resume' : 'Pause'}
        </button>
        <span className="ops-label">Speed</span>
        <div className="ops-stops" role="group" aria-label="Ticks per beat">
          {SPEED_STOPS.map((x) => (
            <button
              type="button"
              key={x}
              className="rx-full ops-stop"
              aria-pressed={clock.speed === x}
              onClick={() => {
                onWrite('/admin/speed', { x })
              }}
            >
              {x}×
            </button>
          ))}
        </div>
      </div>
      <p className="sheet-note">
        Pausing stops the world clock. The stream keeps serving and the stamp reads PAUSED.
      </p>
    </section>
  )
}

export function ClockSection({
  token,
  onNotice,
}: {
  token: string
  onNotice: (s: string) => void
}) {
  const [clock, reread, down] = useAdminRead<ClockState>(token, '/admin/clock')
  if (clock === null && down) return <OutOfReach onRetry={reread} />
  if (clock === null)
    return (
      <p className="feed-empty" role="status" aria-busy="true">
        Asking the town for its clock…
      </p>
    )
  return (
    <ClockView
      clock={clock}
      onWrite={(path, body) => {
        void ask<ClockState>(fetch, token, path, {
          method: 'POST',
          body: JSON.stringify(body ?? {}),
        }).then((r) => {
          onNotice(failed(r) ? r.error : '')
          reread()
        })
      }}
    />
  )
}

function Ledger({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="ops-ledger">
      {rows.map((r) => (
        <div className="ops-line" key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SpendView({ cost }: { cost: CostReport }) {
  const { answerRate: answer } = cost
  return (
    <section className="ops-block" aria-label="Spend">
      <h3 className="feed-head">Spend</h3>

      <p className="ops-answer">
        <span className="ops-figure">{pct(answer.rate)}</span>
        <span className="ops-answer-says">
          of {answer.stated} acts begun were finished — {answer.abandoned} were given up,{' '}
          {answer.inFlight} are still under way.
        </span>
      </p>
      {answer.byVerb.length > 0 && (
        <ul className="ops-verbs">
          {answer.byVerb.slice(0, 6).map((v) => (
            <li key={v.verb}>
              <code className="law-path">{v.verb}</code>
              <span className="ops-num">
                {v.answered} of {v.stated}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!cost.live ? (
        <p className="feed-empty">This town is scripted. Nothing has been bought.</p>
      ) : (
        <>
          <Ledger
            rows={[
              { label: 'Today', value: `${usd(cost.today.usd)} · ${cost.today.calls} calls` },
              {
                label: 'Projected',
                value: `${usd(cost.projection.usdPerSimDay)} a sim-day, off the last ${cost.projection.windowRealMinutes} real minutes`,
              },
              {
                label: 'Lifetime',
                value: `${usd(cost.lifetime.usd)} · ${cost.lifetime.calls} calls`,
              },
              { label: 'Read from cache', value: pct(cost.cacheReadShare) },
              {
                label: 'Daily budget',
                value: `${usd(cost.caps.dailyUsd)}${cost.stop.dailyReached ? ' — reached' : ''}`,
              },
              {
                label: 'Lifetime cap',
                value:
                  cost.caps.lifetimeUsd === 0
                    ? 'none'
                    : `${usd(cost.caps.lifetimeUsd)}${cost.stop.lifetimeReached ? ' — reached' : ''}`,
              },
            ]}
          />
          <h4 className="ops-sub">By caller</h4>
          <Ledger
            rows={cost.byCaller.map((c) => ({
              label: c.caller,
              value: `${usd(c.usd)} · ${c.calls}`,
            }))}
          />
          <h4 className="ops-sub">By mind</h4>
          <Ledger
            rows={cost.byMind.map((m) => ({
              label: m.agentId,
              value: `${usd(m.usd)} · ${m.calls}`,
            }))}
          />
          {cost.alerts.length > 0 && (
            <>
              <h4 className="ops-sub">Alerts</h4>
              <ul className="ops-alerts">
                {cost.alerts.map((a) => (
                  <li key={`${a.ts}-${a.kind}`}>
                    <code className="law-path">{a.kind}</code> {a.detail}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}

export function SpendSection({ token }: { token: string }) {
  const [cost, reread, down] = useAdminRead<CostReport>(token, '/admin/cost')
  if (cost === null && down) return <OutOfReach onRetry={reread} />
  if (cost === null)
    return (
      <p className="feed-empty" role="status" aria-busy="true">
        Reading the ledger…
      </p>
    )
  return <SpendView cost={cost} />
}

export function RulingsView({
  pending,
  onDecide,
}: {
  pending: readonly PendingRuling[]
  onDecide: (ruleId: number, verdict: 'approve' | 'revert', reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const decide = (ruleId: number, verdict: 'approve' | 'revert'): void => {
    onDecide(ruleId, verdict, reason)
    setReason('')
  }
  return (
    <section className="ops-block" aria-label="Rulings awaiting review">
      <h3 className="feed-head">Rulings</h3>
      {pending.length === 0 ? (
        <p className="feed-empty">Nothing is waiting on a person.</p>
      ) : (
        <>
          <ul className="ops-rulings">
            {pending.map((r) => (
              <li className="ops-ruling" key={r.id}>
                <code className="law-path">{r.recipeId}</code>
                <span className="ops-at">{momentStamp(r.tick)}</span>
                <button
                  type="button"
                  className="rx-full"
                  onClick={() => {
                    decide(r.ruleId, 'approve')
                  }}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="rx-full"
                  onClick={() => {
                    decide(r.ruleId, 'revert')
                  }}
                >
                  Revert
                </button>
              </li>
            ))}
          </ul>
          <label className="ops-reason" htmlFor="ruling-reason">
            Why
            <input
              id="ruling-reason"
              type="text"
              value={reason}
              placeholder="written into the rulebook beside the reverted rule"
              onChange={(e) => {
                setReason(e.target.value)
              }}
            />
          </label>
        </>
      )}
      <p className="sheet-note">
        Reverting takes the word back out of the world: the rule is tombstoned and the verb it
        minted stops answering.
      </p>
    </section>
  )
}

export function RulingsSection({
  token,
  onNotice,
}: {
  token: string
  onNotice: (s: string) => void
}) {
  const [queue, reread, down] = useAdminRead<{ pending: PendingRuling[] }>(
    token,
    '/admin/rulings/pending',
  )
  if (queue === null && down) return <OutOfReach onRetry={reread} />
  if (queue === null)
    return (
      <p className="feed-empty" role="status" aria-busy="true">
        Reading the queue…
      </p>
    )
  return (
    <RulingsView
      pending={queue.pending}
      onDecide={(ruleId, verdict, reason) => {
        void ask(fetch, token, `/admin/rulings/${ruleId}/${verdict}`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }).then((r) => {
          onNotice(failed(r) ? r.error : '')
          reread()
        })
      }}
    />
  )
}

/** The browser reads the blob during the save, and a revoke on the same turn can beat it to it;
 *  a detached anchor is never dispatched at all in some browsers. */
export const SAVE_HOLD_MS = 60_000
export function handToBrowser(doc: Document, url: string, name: string): void {
  const a = doc.createElement('a')
  a.href = url
  a.download = name
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, SAVE_HOLD_MS)
}

/** A link that carries a bearer, which an anchor cannot: the channel refuses an unauthorized
 *  GET, so the file is fetched and then handed to the browser to save. */
export function ExportLink({ token, onNotice }: { token: string; onNotice: (s: string) => void }) {
  const [asking, setAsking] = useState(false)
  const download = (): void => {
    setAsking(true)
    void fetch('/admin/export', { headers: { authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`the channel answered ${res.status}`)
        handToBrowser(document, URL.createObjectURL(await res.blob()), 'san-junipero-run.tar')
      })
      .catch((err: unknown) => {
        onNotice(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setAsking(false)
      })
  }
  return (
    <p className="ops-export">
      <button type="button" className="ops-link" disabled={asking} onClick={download}>
        {asking ? 'Packing the run…' : 'Download the whole run'}
      </button>
      <span className="sheet-note">
        The world log, every mind, the god layer, the config and a manifest — enough to replay this
        town somewhere else.
      </span>
    </p>
  )
}
