# C12 AMENDMENT — THE UI PASS (USER-MANDATED 2026-08-17, BINDING)

Ratify this file together with cleanup/2026-08-17-12-deep-presentation.DRAFT.md. It adds
a phase and amends the gates. Where it conflicts with the base plan, THIS FILE WINS.

USER MANDATE (verbatim): "enhance C12 with a pass over the UI for usability, any bugs,
and any issues. We need a really rich display. We need all the font sizes to be readable
and all the text to be legible. Let's include in C12 a pass over the entire UI."

The base plan's UI QUALITY MANDATE (AAA bar, pixel-art-native, tints.ts palette, motion
150–300ms, reduced-motion, WCAG AA, keyboard nav) stays in Global Constraints and is
NECESSARY BUT NOT SUFFICIENT: it governs what each task builds. This amendment adds a
pass over the WHOLE surface, including everything built in C6/C10 before that mandate
existed.

## LANDED EARLY — do not redo (branch `ui-blockers` off main a6d0a68)

The audit's BLOCKER rows plus two systemic wins were pulled forward because the
production run may precede C12: the Pixi DPR/resolution fix, the chronicle
badge-vs-panel disagreement, the timeline's 1.00:1 labels and empty track, TEXT
LEGIBILITY FLOORS (12px absolute / 14px body / readable world text — floors only), and
the `--ink-quiet` token replacing opacity-based de-emphasis at ~23 sites. Task 53 still
owns the full six-step scale; Task 54 still owns the complete AA matrix. Read
cleanup/ui-blockers-report.md and treat those defects as CLOSED unless it says otherwise.

## Evidence input

cleanup/ui-audit-report.md — a full-surface audit of the live app (defect table with
severities, typography inventory, measured contrast failures, richness gaps, bugs,
top 10). Tasks 55–57 WORK THAT TABLE. If a defect in it has no task, the pass is
incomplete. Read it before planning any of these tasks.

## NEW PHASE K — the UI pass (executes AFTER Phase I, BEFORE the Phase J gates)

Tasks numbered 53+ so existing task numbers and rulings stay stable.

### Task 53 — The type system
ONE coherent, documented type scale as tokens (no ad-hoc sizes anywhere in
packages/web). Every existing size maps onto a rung, and the report says which moved.
HARD FLOORS: nothing under 12px renders text, ever; body copy is ≥14px; the scrubber,
ticker, lower-thirds and any broadcast-distance text are sized for across-the-room
reading, not desk reading. Canvas/pixi text obeys the same scale in CSS pixels and
scales with zoom rather than being pinned in device pixels. Test: a lint-style unit
test that fails on a raw font-size outside the token set, and a test asserting the
floors.

### Task 54 — Contrast and palette compliance
Every text/surface pair meets WCAG AA (4.5:1 body, 3:1 large) against the ACTUAL painted
background, including text over the map, over sprites, and over translucent panels
(those need a scrim, not hope). All colors come from tints.ts; hardcoded values are
removed. Test: a computed-contrast unit test over the token matrix, and the drift test
that no raw hex enters packages/web.

### Task 55 — Defect remediation, severity-ordered
Fix every BLOCKER and MAJOR in the audit's defect table: clipping, truncation, overlap,
overflow, layout breaks at 1280×800 / 1440×900 / 1920×1080, hit targets under 24px,
missing focus states, jitter and reflow. Each fix names its defect id. MINOR/POLISH
items are fixed where cheap and explicitly deferred with a reason where not.

### Task 56 — Usability and navigation coherence
Every view is escapable and every drill-down is reversible (the roster back-button class
of bug, found live, must be impossible by construction — one shared navigation
primitive, not per-panel handling). Every surface has real empty, loading, and error
states. Keyboard reaches everything interactive in a sane order. Consistent affordances:
what is clickable looks clickable, everywhere.

### Task 57 — The richness pass ("a really rich display")
Work the audit's RICHNESS GAPS. Any panel that under-displays available data gets real
information design: state encoded in form as well as number (chips, bars, severity
stripes, sparklines), summary before detail, relationships shown rather than described.
A raw number the user must interpret is a defect when a visual encoding would read
faster. CONSTRAINT: this is density with hierarchy, never clutter — every added element
answers a question a viewer actually has, and §11/§23 hold (no leaked raw HP or skill
integers; the inspector's existing violations are already in scope at base Task 22).

### Task 58 — UI pass verification
Re-run the audit's measurements from Task 53–57's result: typography inventory clean
against the scale, zero AA failures, zero open BLOCKER/MAJOR defects, richness gaps
closed or explicitly deferred with reasons. Produce a before/after table. This is the
evidence Phase J's gates cite.

## GATE AMENDMENTS

- G12a (base Task 51) gains the automated half: type-scale lint test, contrast matrix
  test, palette drift test, navigation-reversibility tests, the floors test.
- G12b (base Task 52) gains the human-evidenced half: a walk of every surface at
  1280×800 and 1920×1080 plus the phone layout, with the Task 58 before/after table
  attached. G12b does NOT pass with an open BLOCKER or MAJOR.

## Standing notes

- The pass covers surfaces built in C6 and C10 as well as C12's own — "the entire UI"
  is literal.
- Landed house law still binds: hitArea = footprint diamond; buildings anchor at the
  base diamond and overflow upward (~1.85×); bakes coalesce one per frame; terrain is
  continuous world-space material.
- Anything the pass finds that is an ENGINE defect rather than a UI defect gets ledgered
  for C8's cross-chunk audit, not fixed in the UI lane.
