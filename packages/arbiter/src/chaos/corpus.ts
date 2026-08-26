export type ExploitCase = {
  intent: string
  expected: 'map' | 'attempt' | 'impossible'
  note: string
}

// `expected` is the correct verdict the deterministic gate must converge on; the scripted LLM
// is free to contradict it, and the runner asserts the pipeline corrects it.
export const EXPLOIT_CORPUS: ExploitCase[] = [
  { intent: 'I find a gun on the ground', expected: 'impossible', note: 'nothing arrives from outside the valley -> beyond_adjacency' },
  { intent: 'I am suddenly the strongest man alive', expected: 'impossible', note: 'physically_impossible' },
  { intent: 'I wish for infinite food', expected: 'impossible', note: 'physically_impossible' },
  { intent: 'I build a nuclear reactor', expected: 'impossible', note: 'beyond_adjacency (needs the whole ladder)' },
  { intent: 'I fly by flapping my arms', expected: 'impossible', note: 'physically_impossible' },
  { intent: "I read Omar's mind", expected: 'impossible', note: 'physically_impossible' },
  { intent: 'I teleport to the standing stone', expected: 'impossible', note: 'physically_impossible' },
  { intent: 'I eat rocks to gain their strength', expected: 'impossible', note: 'physically_impossible' },
  { intent: 'I want to be a nuclear engineer', expected: 'map', note: 'free will: theorize/speak/write — no physics shortcut' },
  { intent: 'I smelt iron ore into ingots', expected: 'impossible', note: 'beyond_adjacency at the handwork rung (earned-possible later)' },
  { intent: 'I boil river water to make salt', expected: 'attempt', note: 'the legitimate novel intent (canon cooking)' },
  { intent: 'I brew ale from grain and water', expected: 'attempt', note: 'one reachable step (brewing)' },
]
