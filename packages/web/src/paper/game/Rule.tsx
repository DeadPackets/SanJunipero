import { useSyncExternalStore } from 'react'
import { LawsResponseSchema, agentName, type LawRow } from '@sj/shared'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { pointPlay } from '../../ui/replayRun.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from '../pages/types.js'
import { GameIcon, FeedState, Empty } from './shared.js'

const parseLaws = (body: unknown): LawRow[] | null => {
  const p = LawsResponseSchema.safeParse(body)
  return p.success ? p.data.laws : null
}
export function GameRule(props: PageProps) {
  const { store, tab, onPlay } = props
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const endpoint = useEndpointFor('/api/laws', parseLaws, 30_000)
  const read = useFeed(endpoint)
  const tick = state?.tick ?? 0
  const laws = (read.data ?? []).filter((l) => l.ratifiedTick <= tick)
  const active = laws.filter((l) => l.repealedTick === null || l.repealedTick > tick)
  if (tab === 'How it works')
    return (
      <>
        <div className="sj-dispatch">
          <GameIcon kind="rule" />
          <div>
            <h3>A town that decides together</h3>
            <p>Its agreements come from its people.</p>
          </div>
        </div>
        <ol className="sj-rule-steps">
          <li>
            <GameIcon kind="note" />
            <div>
              <h3>Someone puts an idea into words</h3>
              <p>A person proposes a rule during life in the town.</p>
            </div>
          </li>
          <li>
            <GameIcon kind="people" />
            <div>
              <h3>The town has its say</h3>
              <p>The record shows who spoke for it and who spoke against it.</p>
            </div>
          </li>
          <li>
            <GameIcon kind="medal" />
            <div>
              <h3>An agreement becomes part of the story</h3>
              <p>See when it passed, how it is enforced and whether it was later repealed.</p>
            </div>
          </li>
        </ol>
        <p className="sj-footnote">
          You are here to observe. Nothing you open or follow tells the townspeople what to do.
        </p>
        {props.operatorToken && (
          <details className="sj-details">
            <summary>Operator tools</summary>
            <button
              className="sj-link"
              type="button"
              onClick={() => props.onBrowse?.('laws', 'Admin')}
            >
              Open world controls →
            </button>
          </details>
        )}
      </>
    )
  const moments = laws
    .flatMap((l) => [
      { key: `${l.id}:agreed`, tick: l.ratifiedTick, title: 'An agreement made', law: l },
      ...(l.repealedTick !== null && l.repealedTick <= tick
        ? [{ key: `${l.id}:repealed`, tick: l.repealedTick, title: 'A rule reconsidered', law: l }]
        : []),
    ])
    .sort((a, b) => b.tick - a.tick)
  return (
    <>
      <div className="sj-dispatch">
        <GameIcon kind={tab === 'Milestones' ? 'medal' : 'rule'} />
        <div>
          <h3>
            {tab === 'Milestones' ? 'Learning to live together' : 'The agreements they live by'}
          </h3>
          <p>
            {tab === 'Milestones'
              ? 'Decisions that became part of this town’s history.'
              : `${active.length} ${active.length === 1 ? 'agreement stands' : 'agreements stand'} in the town at this moment.`}
          </p>
        </div>
      </div>
      <FeedState read={read} retry={endpoint.retry} />
      {tab === 'Milestones' ? (
        <div className="sj-awards">
          {moments.map((m) => (
            <button
              type="button"
              className="sj-award sj-rule-award"
              key={m.key}
              onClick={() =>
                onPlay(pointPlay(m.tick, store.liveEdge(), m.title, [m.law.proposedBy]))
              }
            >
              <GameIcon kind="medal" />
              <span className="sj-meta">{momentStamp(m.tick)}</span>
              <strong>{m.title}</strong>
              <span>“{m.law.text}”</span>
              <span className="sj-link">Watch the decision →</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="sj-agreements">
          {laws.map((l) => {
            const repealed = l.repealedTick !== null && l.repealedTick <= tick
            return (
              <article className="sj-agreement" key={l.id}>
                <span className="sj-meta">
                  <GameIcon kind="rule" />
                  {repealed ? 'Repealed' : 'Agreed'} · {momentStamp(l.ratifiedTick)}
                </span>
                <h3>“{l.text}”</h3>
                <p>Proposed by {l.proposerName}</p>
                <p>
                  {l.why ||
                    (l.enforced
                      ? 'Enforced in the town.'
                      : 'An agreement in words, without automatic enforcement.')}
                </p>
                <details className="sj-details">
                  <summary>
                    {l.votes.for.length} for · {l.votes.against.length} against — see the voices
                  </summary>
                  <p>
                    For:{' '}
                    {l.votes.for.map((id) => agentName(state?.agents, id)).join(', ') ||
                      'Nobody recorded'}
                  </p>
                  <p>
                    Against:{' '}
                    {l.votes.against.map((id) => agentName(state?.agents, id)).join(', ') ||
                      'Nobody recorded'}
                  </p>
                </details>
                {mode.live && (
                  <p className="sj-meta">
                    {l.enforced ? 'Enforced' : 'In words only'} · {l.breaches} recorded breaches
                  </p>
                )}
                {repealed && <p className="sj-meta">Repealed {momentStamp(l.repealedTick!)}</p>}
                <button
                  className="sj-link"
                  type="button"
                  onClick={() =>
                    onPlay(pointPlay(l.ratifiedTick, store.liveEdge(), l.text, [l.proposedBy]))
                  }
                >
                  Watch the agreement →
                </button>
              </article>
            )
          })}
        </div>
      )}
      {read.loaded && !read.failed && !laws.length && (
        <Empty
          icon={tab === 'Milestones' ? 'medal' : 'rule'}
          title={
            tab === 'Milestones' ? 'Their first agreement is ahead' : 'A fresh page for the town'
          }
        >
          No agreements have been recorded yet. When the people decide something together, you can
          read it here.
        </Empty>
      )}
    </>
  )
}
