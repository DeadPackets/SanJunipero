import { describe, expect, it } from 'vitest'
import { ServerScene, type SimEvent } from '@sj/shared'
import { makeSceneRelay } from './scenes.js'

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
  it('opens on scene_opened and closes with the summary', () => {
    const relay = makeSceneRelay()
    const [open] = relay([ev('scene_opened', OPENED)])
    expect(ServerScene.safeParse(open).success).toBe(true)
    expect(open?.scene).toEqual({ ...OPENED, open: true })

    const [closed] = relay([
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
    relay([ev('scene_opened', OPENED)])
    const [turned] = relay([
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
    const [closed] = relay([
      ev('scene_closed', { id: OPENED.id, summary: 'A rule.', deltas: [], closeReason: 'ended' }),
    ])
    expect(closed?.scene.participants).toEqual(['nadia', 'omar', 'salma'])
  })

  it('says nothing about a turn in a scene it never saw open', () => {
    expect(
      makeSceneRelay()([
        ev('scene_turned', { id: OPENED.id, kind: 'quarrel', participants: ['a'], stakes: 7 }),
      ]),
    ).toEqual([])
  })

  it('sends no frame for a line — the words already reach a viewer as speech', () => {
    const relay = makeSceneRelay()
    relay([ev('scene_opened', OPENED)])
    expect(
      relay([
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
    expect(relay([close])).toEqual([])
    relay([ev('scene_opened', OPENED)])
    expect(relay([close])).toHaveLength(1)
    expect(relay([close])).toEqual([])
  })

  it('carries two scenes at once without crossing them', () => {
    const relay = makeSceneRelay()
    const second = { ...OPENED, id: 'scene_800_deadbeef', participants: ['salma', 'yusuf'] }
    relay([ev('scene_opened', OPENED), ev('scene_opened', second)])
    const [closed] = relay([
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
