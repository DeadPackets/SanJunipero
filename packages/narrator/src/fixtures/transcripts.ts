import type { TranscriptRecord } from '../semanticFirsts.js'

// One authored day, written so each rule of §20 has something to bite on: a god reference in
// plain speech, a clean lie with both sides inside the window, a change of mind whose thought
// comes AFTER the words, and an honest error where the inner record agrees with the mouth.

export const DAY = 4
const tickOf = (hour: number, minute = 0): number => DAY * 1440 + hour * 60 + minute

export const GOD_QUOTE = 'When Bex went, she went on somewhere. The dead are not nothing.'
export const LIE_SPOKEN = 'I never touched your knife.'
export const LIE_THOUGHT = 'I took the knife off the shelf and I mean to keep it.'
export const CHANGED_MIND_SPOKEN = 'I will go north at first light.'
export const CHANGED_MIND_THOUGHT = 'North is folly. I stay where the fire is.'
export const HONEST_ERROR_SPOKEN = 'The weir is empty. There are no fish left in the river.'
export const HONEST_ERROR_THOUGHT = 'The weir is empty.'

export const AUTHORED_DAY: TranscriptRecord[] = [
  { sourceKind: 'speech', agentId: 'ada', day: DAY, tick: tickOf(8), text: GOD_QUOTE, eventSeq: 101 },
  { sourceKind: 'thought', agentId: 'cass', day: DAY, tick: tickOf(10, 10), text: LIE_THOUGHT, memoryRef: 'mem_7' },
  { sourceKind: 'speech', agentId: 'cass', day: DAY, tick: tickOf(11), text: LIE_SPOKEN, eventSeq: 118 },
  { sourceKind: 'speech', agentId: 'dov', day: DAY, tick: tickOf(13), text: CHANGED_MIND_SPOKEN, eventSeq: 130 },
  { sourceKind: 'thought', agentId: 'dov', day: DAY, tick: tickOf(14), text: CHANGED_MIND_THOUGHT, memoryRef: 'mem_9' },
  { sourceKind: 'thought', agentId: 'esen', day: DAY, tick: tickOf(15, 50), text: HONEST_ERROR_THOUGHT, memoryRef: 'mem_11' },
  { sourceKind: 'speech', agentId: 'esen', day: DAY, tick: tickOf(16), text: HONEST_ERROR_SPOKEN, eventSeq: 140 },
]

// What a well-behaved model would answer for that day: the god reference, the lie with both
// its sides, and the change of mind reported as a lie — which the ordering rule then voids.
export const GOOD_VERDICT = {
  hits: [
    {
      conceptKind: 'god_afterlife', agentId: 'ada', day: DAY, sourceKind: 'speech', eventSeq: 101,
      quote: 'The dead are not nothing.', confidence: 0.93,
      rationale: 'She speaks of the dead as continuing.',
    },
    {
      conceptKind: 'lie', agentId: 'cass', day: DAY, sourceKind: 'speech', eventSeq: 118,
      quote: LIE_SPOKEN, quote2: LIE_THOUGHT, provenance2: 'mem_7', confidence: 0.95,
      rationale: 'She says she never touched it; she had already thought she took it.',
    },
    {
      conceptKind: 'lie', agentId: 'dov', day: DAY, sourceKind: 'speech', eventSeq: 130,
      quote: CHANGED_MIND_SPOKEN, quote2: CHANGED_MIND_THOUGHT, provenance2: 'mem_9', confidence: 0.91,
      rationale: 'He said he would go and then thought he would not.',
    },
  ],
}
