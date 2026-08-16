import type { SimEvent } from '@sj/shared'

const ev = (seq: number, tick: number, type: string, payload: unknown): SimEvent => ({ seq, tick, type, payload })

// The committed day-0 "recording" the G7 gate replays: three scenes separated by
// >20-tick silences. The evening trade carries a trailing agent_moved so the scene
// survives the segmenter's minEvents=2 floor.
export const EVENTFUL_DAY: SimEvent[] = [
  // scene 1 — morning idle: low heat
  ev(1, 480, 'agent_moved', { id: 'omar', x: 1, y: 1 }),
  ev(2, 481, 'agent_moved', { id: 'yusuf', x: 2, y: 1 }),
  ev(3, 482, 'crop_grew', { cropId: 'c1' }),
  // scene 2 — midday argument: conflict + stakes + novelty + dramatic irony
  ev(4, 720, 'agent_spoke', { agentId: 'omar', text: 'The wall is mine to raise.', x: 3, y: 4 }),
  ev(5, 721, 'agent_spoke', { agentId: 'yusuf', text: 'It stands on my plot.', x: 3, y: 4 }),
  ev(6, 722, 'agent_spoke', { agentId: 'omar', text: 'Then move your plot.', x: 3, y: 4 }),
  ev(7, 723, 'agent_spoke', { agentId: 'yusuf', text: 'Never.', x: 3, y: 4 }),
  ev(8, 724, 'action_interrupted', { agentId: 'omar', verb: 'build' }),
  ev(9, 725, 'agent_injured', { agentId: 'yusuf', kind: 'bruise' }),
  // scene 3 — evening first trade
  ev(10, 1200, 'action_completed', { agentId: 'omar', verb: 'give', targetId: 'yusuf' }),
  ev(11, 1201, 'agent_moved', { id: 'omar', x: 5, y: 6 }),
]
