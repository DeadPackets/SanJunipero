import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { ServerScene, type SimEvent } from '@sj/shared'
import { makeSceneRelay, scenesAt } from './scenes.js'

let seq = 0
const ev = (type: string, payload: unknown): SimEvent => ({ seq: ++seq, tick: 720, type, payload })

const OPENED = {
  id: 'scene_720_ab12cd34',
  kind: 'quarrel',
  participants: ['nadia', 'omar'],
  topic: 'Omar. Six planks.',
  stakes: 5,
}

describe('the scene frame', () => {
  it('restores a conversation across midnight and respects the requested historical tick', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
    insert.run(1, 1435, 'scene_opened', JSON.stringify(OPENED))
    insert.run(2, 1441, 'scene_turned', JSON.stringify({ ...OPENED, kind: 'council' }))
    insert.run(3, 1450, 'scene_closed', JSON.stringify({ id: OPENED.id, summary: 'Done.' }))
    expect(scenesAt(db, 1439).snapshot()[0]?.scene.kind).toBe('quarrel')
    expect(scenesAt(db, 1445).snapshot()[0]?.scene.kind).toBe('council')
    expect(scenesAt(db, 1450).snapshot()).toEqual([])
    db.close()
  })
  it('keeps the current open scenes for late viewers without replaying closed ones', () => {
    const relay = makeSceneRelay()
    relay.fold([ev('scene_opened', OPENED)])
    expect(relay.snapshot()).toEqual([{ t: 'scene', scene: { ...OPENED, open: true } }])
    relay.fold([ev('scene_closed', { id: OPENED.id, summary: 'Done.' })])
    expect(relay.snapshot()).toEqual([])
  })
  it('ends immediately and later enriches the same closed scene with a summary', () => {
    const relay = makeSceneRelay()
    relay.fold([ev('scene_opened', OPENED)])
    const [ended] = relay.fold([ev('scene_ended', { id: OPENED.id, closeReason: 'left' })])
    expect(ended?.scene).toEqual({ ...OPENED, open: false })
    expect(relay.snapshot()).toEqual([])
    const [summarized] = relay.fold([
      ev('scene_closed', {
        id: OPENED.id,
        summary: 'Omar left after the question.',
        deltas: [],
        closeReason: 'left',
      }),
    ])
    expect(summarized?.scene).toEqual({
      ...OPENED,
      open: false,
      summary: 'Omar left after the question.',
    })
    expect(relay.snapshot()).toEqual([])
  })
  it('does not restore a scene after its ending while summary is pending', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE events (seq INTEGER PRIMARY KEY, tick INTEGER, type TEXT, payload TEXT)')
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)')
    insert.run(1, 720, 'scene_opened', JSON.stringify(OPENED))
    insert.run(2, 730, 'scene_ended', JSON.stringify({ id: OPENED.id, closeReason: 'left' }))
    expect(scenesAt(db, 729).snapshot()).toHaveLength(1)
    expect(scenesAt(db, 730).snapshot()).toEqual([])
    db.close()
  })
  it('opens on scene_opened and closes with the summary', () => {
    const relay = makeSceneRelay()
    const [open] = relay.fold([ev('scene_opened', OPENED)])
    expect(ServerScene.safeParse(open).success).toBe(true)
    expect(open?.scene).toEqual({ ...OPENED, open: true })

    const [closed] = relay.fold([
      ev('scene_closed', {
        id: OPENED.id,
        summary: 'She got a day out of him.',
        deltas: [],
        closeReason: 'ended',
      }),
    ])
    expect(ServerScene.safeParse(closed).success).toBe(true)
    expect(closed?.scene).toEqual({ ...OPENED, open: false, summary: 'She got a day out of him.' })
  })

  it('re-sends the scene when the talk turns, with the new kind, cast and stakes', () => {
    const relay = makeSceneRelay()
    relay.fold([ev('scene_opened', OPENED)])
    const [turned] = relay.fold([
      ev('scene_turned', {
        id: OPENED.id,
        kind: 'council',
        participants: ['nadia', 'omar', 'salma'],
        stakes: 8,
      }),
    ])
    expect(ServerScene.safeParse(turned).success).toBe(true)
    expect(turned?.scene).toEqual({
      ...OPENED,
      kind: 'council',
      participants: ['nadia', 'omar', 'salma'],
      stakes: 8,
      open: true,
    })
    // and the close carries the turn forward, not the opening pair
    const [closed] = relay.fold([
      ev('scene_closed', { id: OPENED.id, summary: 'A rule.', deltas: [], closeReason: 'ended' }),
    ])
    expect(closed?.scene.participants).toEqual(['nadia', 'omar', 'salma'])
  })

  it('says nothing about a turn in a scene it never saw open', () => {
    expect(
      makeSceneRelay().fold([
        ev('scene_turned', { id: OPENED.id, kind: 'quarrel', participants: ['a'], stakes: 7 }),
      ]),
    ).toEqual([])
  })

  it('sends no frame for a line — the words already reach a viewer as speech', () => {
    const relay = makeSceneRelay()
    relay.fold([ev('scene_opened', OPENED)])
    expect(
      relay.fold([
        ev('scene_line', {
          id: OPENED.id,
          agentId: 'omar',
          text: 'Ask me about the boy.',
          move: 'press',
        }),
      ]),
    ).toEqual([])
  })

  it('ignores a close for a scene it never saw open, and closes only once', () => {
    const relay = makeSceneRelay()
    const close = ev('scene_closed', {
      id: OPENED.id,
      summary: 's',
      deltas: [],
      closeReason: 'ended',
    })
    expect(relay.fold([close])).toEqual([])
    relay.fold([ev('scene_opened', OPENED)])
    expect(relay.fold([close])).toHaveLength(1)
    expect(relay.fold([close])).toEqual([])
  })

  it('carries two scenes at once without crossing them', () => {
    const relay = makeSceneRelay()
    const second = { ...OPENED, id: 'scene_800_deadbeef', participants: ['salma', 'yusuf'] }
    relay.fold([ev('scene_opened', OPENED), ev('scene_opened', second)])
    const [closed] = relay.fold([
      ev('scene_closed', {
        id: second.id,
        summary: 'By the fire.',
        deltas: [],
        closeReason: 'left',
      }),
    ])
    expect(closed?.scene.participants).toEqual(['salma', 'yusuf'])
  })
})
