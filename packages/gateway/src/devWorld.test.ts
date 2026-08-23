import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import { RngStreams, createWorldTick, genesisState } from '@sj/engine'
import { SHOWCASE_CONFIG, THOUGHT_LINES, startDevWorld } from './devWorld.js'

const until = async (cond: () => boolean, timeoutMs = 12_000): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}
describe('showcase weather', () => {
  it('freezes the weather system so the town never greys out', () => {
    expect(SHOWCASE_CONFIG.weather.hourlyChangeChance).toBe(0)
    expect(genesisState(SHOWCASE_CONFIG).weather).toEqual({ kind: 'sunny', temperatureC: 14 })

    // A full day of world ticks under seed g6 never rolls the kind off sunny.
    const rng = new RngStreams('g6')
    const worldTick = createWorldTick(SHOWCASE_CONFIG, rng)
    let s = genesisState(SHOWCASE_CONFIG)
    for (let tick = 0; tick < 24 * 60; tick++) {
      s = worldTick(s).state
      expect(s.weather.kind).toBe('sunny')
    }
  })
})

describe('dev world server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-devworld-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('serves the founders town live with observer thoughts', async () => {
    const dw = await startDevWorld({ realMsPerTick: 1, port: 0, dbPath: join(dir, 'dev.db') })
    try {
      await until(() => dw.loop.state.tick >= 2)
      dw.gateway.pump() // fold the first ticks into the mirror before the snapshot

      const sock = new WebSocket(`ws://127.0.0.1:${dw.gateway.port}/ws`)
      const frames: string[] = []
      sock.on('message', (d) => frames.push(d.toString()))
      await new Promise((resolve, reject) => { sock.on('open', resolve); sock.on('error', reject) })
      sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))

      await until(() => frames.length >= 1)
      const snap = ServerMsg.parse(JSON.parse(frames[0]!))
      if (snap.t !== 'snapshot') throw new Error('expected snapshot first')
      expect(snap.live).toBe(true)
      const state = snap.state as {
        agents: Record<string, { name: string }>
        structures: Record<string, { kind: string; stage: string }>
      }
      // the five founders by name, the six approved buildings complete on day 0
      expect(Object.keys(state.agents).sort()).toEqual(['amara', 'nadia', 'omar', 'salma', 'yusuf'])
      expect(state.agents['omar']?.name).toBe('Omar')
      const kinds = Object.values(state.structures).map((s) => s.kind).sort()
      expect(kinds).toEqual(['house', 'scaffolding', 'shed', 'standing_stone', 'storehouse', 'wagon'])
      for (const s of Object.values(state.structures)) expect(s.stage).toBe('complete')

      await until(() => dw.loop.state.tick >= 40)
      const parsed = (): ServerMsg[] => frames.map((f) => ServerMsg.parse(JSON.parse(f)))
      await until(() => parsed().filter((m) => m.t === 'tick').length >= 2
        && parsed().some((m) => m.t === 'thought'))

      const ticks = parsed().filter((m) => m.t === 'tick')
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      for (const m of ticks) expect(m.t === 'tick' && m.events.length).toBeGreaterThan(0)

      const thought = parsed().find((m) => m.t === 'thought')!
      expect(thought.t === 'thought' && Object.values(THOUGHT_LINES)).toContain(
        thought.t === 'thought' ? thought.text : '')

      sock.close()
    } finally {
      await dw.stop()
    }
  }, 15_000)
})
