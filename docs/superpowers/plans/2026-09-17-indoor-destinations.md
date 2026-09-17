# Interior choices and conversation context

Goal: implement the two approved improvements without a second planner or furniture simulation.

Decisions: conversation turns receive a bounded physical-context block from current perception. A new move_inside action uses existing kind and targetId intent fields. Choices are bed, hearth, table, storage and beside a resident. One event persists the chosen destination; no renderer coordinates enter engine state. Entry, exit and death clear it. Room capabilities and same-room living targets are validated again at completion. Existing activity placement takes priority while working or sleeping; idle residents keep their chosen destination. Beside resolves to the other resident’s furniture or resting place, never their animated position. Mutual choices use stable room slots to prevent chasing.

1. Add shared destination shape, verb validation, event folding and perception. Verify isolated valid/invalid actions and replay equivalence.
2. Ground scene turns in perception and expose destinations to ordinary prompts. Verify real prompt text, action decoding and current facts.
3. Map choices into existing room pathfinding and occupant status. Verify visual preview and viewer build.
4. Save local branch and hand over. AI minds and production remain untouched. No full test suites or release gates; use a disposable in-memory check and local visual review.

Delivered: all four steps implemented on codex/interiors-redesign. Destination state uses one optional field and one replayable event. The Three.js viewer reuses its existing pathfinder, with work and sleep taking priority. Awake bed choices use visible beds, excluding hidden guest bedrolls. Resident labels show the selected place.

Verification: a disposable in-memory script passed all five destinations through actual intent submission and world ticks, rejected absent furniture, invalid targets, sleeping and collapsed movement, checked departure cleanup, prompt grounding and identical event replay. No AI calls or town database writes were used for these checks. Browser review uses an isolated copy of the town at /client/indoor-review.html. The viewer build succeeds. Project-reference typechecking reports only the seven pre-existing UI test-fixture errors.

Limits: no live-mind rehearsal was run. Choosing a place does not start sleep, cooking or storage actions; those remain separate existing actions. Indoor coordinates remain presentation state. The legacy Pixi room renderer is unchanged; named destinations are displayed by the active Three.js renderer.
