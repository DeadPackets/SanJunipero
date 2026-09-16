Static referee audit of `/Users/deadpackets/workspace/SanJunipero/.worktrees/interiors-redesign`. I independently read the implementation for all seven claims. No code edits, tests, gates, browser interaction, or AI calls were used. Runtime symptoms remain inferred from source.

---
**BUG-1**
- **Hunter's claim:** Dragging or dismissing the undocked journal shifts it left by half its width.
- **Skeptic's response:** ACCEPT. The sheet is centered by CSS grid; there is no horizontal offset to cancel.
- **Your analysis:** `Paper.tsx:134` applies `translate(-50%, ${y}px)` during drag, and line 205 applies `translate(-50%, 102%)` during dismissal. The actual `.paper` layout in `chrome.css:1370–1381` uses `justify-self: center` and vertical-only translation. Later `game.css`, `corner-controls.css`, and `almanac.css` supply no compensating horizontal positioning. The desktop dock hides its grip, but the undocked sheet retains one. Its first nonzero vertical movement therefore also moves it horizontally by half its own width. Both reviewers are right.
- **VERDICT: REAL BUG**
- **Confidence:** High
- **True severity:** Medium
- **Suggested fix:** Use `translateY(${y}px)` for dragging and `translateY(102%)` for dismissal, matching the undocked sheet's CSS transform.
---

---
**BUG-2**
- **Hunter's claim:** A historical person's Now page presents the latest live thought as if it belongs to the selected historical moment.
- **Skeptic's response:** ACCEPT. The router allows Now during replay, and the thought cache is neither historical nor filtered.
- **Your analysis:** `GamePerson` reads `store.latestThought(a.id)` unconditionally at `Folk.tsx:164` and renders its text beneath “On their mind” at lines 277–283. `worldStore.ts:171` returns the retained latest-thought map; scrubbed/replaying transitions at lines 255–280 do not clear it. `paper/pages/index.tsx` permits the Now page in historical mode. A thought from a later tick therefore survives a scrub to an earlier tick and appears alongside that older person's state. The adjacent aim is correctly restricted to live mode. Both reviewers are right.
- **VERDICT: REAL BUG**
- **Confidence:** High
- **True severity:** Medium
- **Suggested fix:** Restrict the latest live thought to live mode, with historical copy explaining its absence. Only show historical thoughts if a record at or before the selected tick is explicitly selected from a historical source.
---

---
**BUG-3**
- **Hunter's claim:** “Find this place in town” moves the exterior camera but leaves a manually opened interior visible.
- **Skeptic's response:** ACCEPT. Clearing following does not close a manually opened room, and the held director does not guarantee an exit.
- **Your analysis:** The building branch in `App.tsx:579–593` clears following/play, holds the director, clears exterior follow, and centers on the building. It never deactivates the interior. `interior.ts:219–226` only calls `setActive` for a non-null followed agent. Thus the following effect cannot exit the room when following is cleared. `cameraRig.ts:98–104` changes only the exterior camera, and the held claim in `DirectorMode.tsx:145` returns without moving the view. A manually opened interior can remain active after the action closes the journal. Both reviewers are right.
- **VERDICT: REAL BUG**
- **Confidence:** High
- **True severity:** Medium
- **Suggested fix:** Explicitly leave the interior before centering the exterior on the selected building, using the existing interior exit mechanism while preserving the director hold.
---

---
**BUG-4**
- **Hunter's claim:** At widths of 1000 pixels or less, the drawer and its beat card, shot board, and dossier rail become inaccessible.
- **Skeptic's response:** DISPROVE. The owner explicitly requested removal of the mobile bottom box and dragging notch; this is the requested interface change.
- **Your analysis:** `corner-controls.css:174–176` does hide the drawer handle, sheet, and scrim. `App.tsx:527–532` mounts the three panels inside that drawer, and the import order in `main.tsx` allows the override to win over the older mobile drawer CSS. The technical observation is correct. However, the supplied owner instruction explicitly authorizes removing this mobile surface and its opener. There is no stated requirement to relocate these panels into another mobile control. Treating their removal as a regression would reverse the requested change. The Skeptic is right in this task context.
- **VERDICT: NOT A BUG**
- **Confidence:** High
---

---
**BUG-5**
- **Hunter's claim:** Panning or zooming a paused town does not make newly visible people available to keyboard navigation.
- **Skeptic's response:** ACCEPT. Preserving tab order does not justify an indefinitely stale set of available people.
- **Your analysis:** `figuresInView` filters out offscreen people before returning subjects. `Figures.tsx:54–57` memoizes this set using only `scene` and `state`. Camera movement does not change either identity during a fixed scrubbed snapshot. The stage loop at lines 64–84 only repositions or hides nodes already in `nodes.current`; it cannot mount buttons for excluded people. Rendering at line 93 uses the stale set. The store also retains the same historical state while its clock is stopped. Newly visible people remain absent from the keyboard layer until a world-state change. Both reviewers are right.
- **VERDICT: REAL BUG**
- **Confidence:** High
- **True severity:** Medium
- **Suggested fix:** Make the mounted candidate set independent of the current viewport, then let the existing frame loop control visibility. Alternatively refresh membership on camera changes while retaining a stable order and focused element. Avoid re-sorting the tab sequence every animation frame.
---

---
**BUG-6**
- **Hunter's claim:** Selecting a different world item while Discoveries is docked can leave the previous discovery or list visible.
- **Skeptic's response:** ACCEPT. A non-null explicit selection takes priority over the new item's derived discovery and persists across item changes.
- **Your analysis:** `Land.tsx:168–176` stores `selected` locally and gives that explicit sequence priority over `made`, the discovery derived from `thing`. “All discoveries” sets `selected` to `-1`, which suppresses the `made` fallback too. `App.tsx:452–455` updates `thing` and opens the same page/tab. `Paper.tsx:331–351` keys the boundary only by page, and the router/GameLand retain the same Discoveries component. There is no item-change reset. Desktop dock CSS disables scrim pointer interception, so clicking the next world item while this component stays mounted is a supported path. Both reviewers are right.
- **VERDICT: REAL BUG**
- **Confidence:** High
- **True severity:** Medium
- **Suggested fix:** Reset the local discovery selection when a new world-item pick arrives, or remount Discoveries for that pick. Preserve “All discoveries” until the next pick, including when the user explicitly picks the same item again.
---

---
**BUG-7**
- **Hunter's claim:** Escape cannot close the journal while a search field has focus.
- **Skeptic's response:** ACCEPT. The typing guard also rejects Escape; the visible keyboard help still advertises its dismissal behavior, although the journal's small Escape hint is hidden.
- **Your analysis:** `useStageKeys.ts:82–86` applies the typing guard before resolving the key. The guard rejects all INPUT, TEXTAREA, and SELECT targets, so an empty search field blocks Escape just as a field containing text does. `shared.tsx:215–221` adds no local Escape handler. The paper supplies no fallback, and the Signpost listener only handles its own expanded menu. `KeyMap.tsx:18` describes Escape as “put down what is up,” and `App.tsx:399–409` supplies the corresponding paper-dismissal action. This is a real low-severity inconsistency: the close button remains usable, and search inputs may legitimately consume an initial Escape to clear text. The defect is clearest once the search field is empty.
- **VERDICT: REAL BUG**
- **Confidence:** Medium
- **True severity:** Low
- **Suggested fix:** Allow unconsumed Escape through the input typing guard while keeping character shortcuts blocked. Respect `defaultPrevented` and any local control dismissal so one key press does not close multiple layers.
---

## Final Report

**VERIFIED BUG REPORT**

Stats:
- Total reported by Hunter: 7
- Dismissed as false positives: 1
- Confirmed as real bugs: 6
- Critical: 0 | Medium: 5 | Low: 1

Confirmed bugs (ordered by severity):

| # | Severity | File | Line(s) | Description | Suggested Fix |
|---|----------|------|---------|-------------|---------------|
| BUG-1 | Medium | packages/web/src/paper/Paper.tsx | 128–135, 201–205 | Journal drag and dismissal introduce an incorrect horizontal offset. | Match CSS with vertical-only transforms. |
| BUG-2 | Medium | packages/web/src/paper/game/Folk.tsx | 164, 277–283 | Historical profile shows a later live thought. | Guard live thoughts in replay, or select a valid historical record. |
| BUG-3 | Medium | packages/web/src/App.tsx | 579–593 | Find-building action leaves the previous interior active. | Explicitly exit the interior before centering the exterior. |
| BUG-5 | Medium | packages/web/src/stage/Figures.tsx | 54–57, 64–84 | Paused camera movement cannot add newly visible keyboard targets. | Decouple mounted candidates from viewport membership or refresh on camera movement. |
| BUG-6 | Medium | packages/web/src/paper/game/Land.tsx | 168–180 | Old discovery selection masks a new world-item pick. | Reset selection or remount for the new pick. |
| BUG-7 | Low | packages/web/src/stage/useStageKeys.ts | 82–86 | Input typing guard blocks Escape dismissal from an empty journal search field. | Allow unconsumed Escape while retaining typing protection. |

Low-confidence items (flagged for manual review):
- BUG-7 — Medium confidence. The source proves Escape is blocked. After fixing, check a focused empty search field and a field with text to preserve local search behavior and dismiss one layer per key press.
