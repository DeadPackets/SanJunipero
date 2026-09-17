# Approved viewing interface

Integrated on `codex/interiors-redesign`; local viewer at http://127.0.0.1:8774/. The existing comparison pages are preserved. No production deployment or paid minds were enabled.

## Composition

- Inset warm-paper frame and centered calendar clock; the clock spans the screen while the journal is docked.
- One vertical control pod and quiet Town Journal. The story pocket reuses the live thread feed. Mobile menus hide the control pod while open.
- Portrait album with the existing category colors and flat icons. People details remain inside Folk.
- Living scene: Pixel balloons follow actual speakers, with resident colors, typed text, a speaker ring and move icons. Three.js rooms project speech through their room camera. The transcript contains public turns received during this visit.
- Keepsake notices use confirmed events and persisted firsts, cap the queue at 12, allow dismissal, and pause on hover or focus. Existing history is baselined and replay/hidden tabs clear the queue. Semantic firsts wait for backend confirmation.

## Verification

The Vite viewer build passes. Manual review covered the desktop composition, docked Folk, the 390 × 844 layout, story pocket, focus return, Pixel speech, transcript and Keepsake appearance. An isolated browser-only harness sent authored event samples through the actual UI components and confirmed replay clears notices; no samples were written to town history. The local scripted town has no recorded conversation turns, so this is not verification of a new paid-minds run.

The TypeScript project build reports 7 pre-existing test-fixture errors in paper, lawSurfaces, storyStrip and directorsCut (missing callback props). No errors point to the new components. No test suites or deployment gates were run.

## Limits

The transcript retains the last 200 received turns, not a full historical conversation archive. Firsts appear after the backend confirms them; the viewer does not invent an achievement from conversation text. Speech and viewing controls never change agent decisions.
