# San Junipero: spectator experience and system audit

Status: audit complete, including independent challenge and source corrections. Main deliverable: `2026-09-21-system-audit.md`. Earlier local UI repairs remain a separate implementation task with browser and audio review still pending. Local branch `codex/viewer-experience`. Production inspection was read-only.

## Decisions

- Evaluate against the owner's goal: an enjoyable Twitch watch with memorable residents, consequences, traditions and reasons to return.
- Preserve real resident agency. A camera can choose what to show; it must not secretly choose what residents want or invent events.
- Keep the requested local UI repairs separate from proposed changes to minds, world rules or models.
- Evaluate Jev using official documentation and this town's measured workload. No paid Jev trial or production change is part of this audit.
- Distinguish verified defects, intentional design tradeoffs, hypotheses and untested paths. Earlier audits are historical evidence, not proof that a defect still exists.

## Coverage and checks

| Workstream | Scope | Check |
|---|---|---|
| Residents | Perception, wakes, plans, actions, memory, reflection, personality, social scenes | Trace production events through runtime and prompts; inspect concrete repeated interactions |
| World | Physics, resources, geometry, ownership, construction, families, laws and customs | Compare implemented constraints with agency principle; reproduce suspected evidence errors |
| Arbiter and Forge | Novel intents, precedent, effect grammar, discovery, asset generation and application | Trace a new capability from request to visible reusable result; identify actual limits |
| Viewer | Transport, late join, camera, bubbles, narration, replay, journal and returning-viewer context | Observe production, compare server evidence with visible state |
| Operations | Scheduling, costs, model failures, persistence, recovery and long-run growth | Read live aggregates and prior rehearsal evidence; distinguish short-run health from long-run quality |

## Deliverables

1. Evidence-backed architectural critique and explicit coverage limits.
2. Recommended minimal target architecture, with alternatives and migration order.
3. Jev suitability, cost examples, limitations and a bounded evaluation proposal.
4. Separate inventory of local fixes completed and still pending visual integration.
5. Watchability measures based on comprehension, consequences and return visits, not raw event volume.

## Deviations

- The user expanded the ongoing local UI repair request into an entire-system audit. Bounded UI work continues independently; speculative mind and world changes remain proposals.
