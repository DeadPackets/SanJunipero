# Current identity and family inheritance

Implemented locally for M6. No production changes or paid calls.

## Current identity

The body is authoritative for current age: `ageYearsFromDays(ageDays)` uses the shared 28-day year. Ordinary and scene prompts read the same runtime identity view. Authored backstory, initial persona and deterministic birth/arrival specification remain historical records; aging does not rewrite them. Current skills also come from the body. Restart rebuilds this view from restored world state, not from a separately persisted age field.

The default child/adult boundary is 16 years (`aging.childUntilYears`), not the generic thirty-year adult fixture constant. Tests advance a body from twelve to the configured threshold and capture both prompt types before and after restarting the runtime.

## Deliberate abstractions

New town births start at twelve (`SPAWN_AGE_YEARS`); infant development is not simulated. A derived birth card says this explicitly. Identity temperament and voice draw deterministically from the parental seed cards. Initial values and beliefs draw from the parent seed personality specifications. These are authored inheritance shortcuts, not learned culture, genetic claims, or copies of the parents’ current private memories. A road arrival uses seed cards for voice without claiming those people were its parents.

Later learned culture must travel through actual witnessed events, teaching, public speech and the resident's own memories. Household seeding reads only the world's public event log and only relevant household/parent events. Each entry retains its event sequence reference, dates the underlying occurrence, and uses second-hand wording. Its memory insertion time remains the child's birth; the embedded date states when the source event happened.

The forty-entry default now ranks consequential events above routine speech, breaks equal importance by newer event sequence, then presents selected entries in event order. An old birth or parental death can survive a speech-filled window. The same log cut produces the same seed on resume; existing event-reference stamps prevent duplicate insertion after a partial birth. This does not grant future knowledge beyond the birth cutoff.
