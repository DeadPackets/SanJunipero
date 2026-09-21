import { expect, it } from 'vitest'
import { speechWithoutMirrors, type AuditEvent } from '../../../scripts/audit-watchability.js'

const event = (
  seq: number,
  tick: number,
  type: string,
  agentId = 'halim',
  text = 'I will check the frame.',
): AuditEvent => ({
  seq,
  tick,
  type,
  payload: { agentId, text },
})

it('counts one utterance when the physical speech lands before or after its scene line', () => {
  const events = [
    event(1, 10, 'agent_spoke'),
    event(2, 11, 'scene_line'),
    event(3, 20, 'scene_line'),
    event(4, 20, 'agent_spoke'),
    event(5, 30, 'scene_line'),
    event(6, 31, 'agent_spoke'),
  ]
  expect(speechWithoutMirrors(events).map((row) => row.seq)).toEqual([2, 3, 5])
})

it('removes only one exact speaker/text match per scene line and keeps actual repetitions', () => {
  const events = [
    event(1, 10, 'agent_spoke'),
    event(2, 10, 'agent_spoke'),
    event(3, 10, 'scene_line'),
    event(4, 10, 'agent_spoke', 'dilara'),
    event(5, 10, 'agent_spoke', 'halim', 'Another thought.'),
    event(6, 12, 'agent_spoke'),
    event(7, 30, 'scene_line'),
    event(8, 30, 'scene_line'),
    event(9, 30, 'agent_spoke'),
  ]
  expect(speechWithoutMirrors(events).map((row) => row.seq)).toEqual([1, 3, 4, 5, 6, 7, 8])
})
