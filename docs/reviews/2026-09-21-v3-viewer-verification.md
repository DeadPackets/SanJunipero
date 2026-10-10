# V3 viewer verification

Local-only checks on 2026-09-21. The existing approved presentation remains in place; alternative viewing designs are deferred.

## Observed in the browser

| Surface | Observation |
| --- | --- |
| Initial asset load | Loading screen reported progress through the 192 current assets before revealing the town. |
| Desktop journal, 1280 × 800 | Dock occupies the rightmost 448 px; document width remains 1280 px. Camera attachment remains left of the dock. |
| Mobile, 390 × 844 | Journal is an edge-attached full-screen drawer. Close is visible, returns focus to Journal, and no red strip/notch is present. Clock, weather and usage fit without horizontal scroll. |
| Controls | Help heading reads “Controls.” |
| Interior, 1440 × 900 | Room header sits below the almanac, with no camera badge overlapping it. Town backdrop is blurred. Sleeping and awake occupants have different visible states. |
| Live public usage | Expanded summary shows active minds, calls, cost, input/output and cached tokens. No operator keys or per-resident private data appear. |
| Live transcript | “Read conversation” contains earlier public lines after a late camera arrival, including the opener. The inspected conversation had 11 lines and multiple speakers. |
| Live room | Halim and Dilara speak in the cottage while Tariq sleeps. Speech attaches to the speaker. |

The usage and transcript observations came from the isolated real-mind rehearsal on port 8776. Desktop/mobile layout checks also used the scripted preview on port 8774. Browser console inspection found no errors; an existing Pixi deprecation warning remains.

## Repairs and post-build checks

- The live typewriter effect revealed long lines too slowly for conversational turn-taking. Text reveal is now capped at 300 ms while the approved entrance animation remains. The rebuilt archive viewer showed the complete three-line Dilara balloon during replay, with tight padding and readable text.
- Text is measured before entrance scaling and only when content, fonts or viewport size change. A focused test checks measurement ordering with and without reduced motion and no additional measurement across unchanged frames.
- A 44 px minimum screen-space person target and pointer-down identity make moving residents easier to select. The name affordance is clickable. Post-build moving-map selection opened Dilara’s actions, and the clickable hover name appeared. This is a desktop observation; it is not a measured touch-target success rate.
- The initial town incorrectly contributed 27 “building finished” timeline marks. Seeded structures now have explicit event provenance; timeline, chronicle, narrator and keepsake regressions verify that seeded completions do not become newly earned events. The active rehearsal retains its original raw events.

## Performance and sound limits

One visible desktop sample reported 1,697 Three.js draw calls. The existing FPS overlay reported about 82 FPS, but it measures animation-frame cadence, not GPU frame duration. This is not a paired before/after measurement or a battery result. No battery-life percentage is claimed.

The asset/terrain synchronization and bubble-layout changes remove unnecessary repeated work. Broader shadow or geometry batching was not added without evidence that it preserves the approved rendering and occlusion behavior.

Automated sound checks cover source gating, mix limits, mute/visibility lifecycle and calm-weather silence. The browser automation available here does not capture audio for listening. A human listening check remains required; it is not represented as completed by those tests.

## Rebuilt viewer observations

The final viewer build was opened against the recorded real day on port 8776. The archive gateway is read-only, disables operator routes and inference, and reports the town as paused at its head. Historical playback uses the existing replay controls. Interior headers remain below the almanac with camera attachments hidden, rooms stay lit and readable, and the town backdrop is blurred. The same home/shop/meeting appearance recipes were visually checked in the dedicated geometry fixture at noon and night, both exterior and interior. Its night room view explicitly assumes one awake occupant and does not claim to test occupancy detection. No console errors were reported in that fixture.

A conversation can include someone standing at the doorway: Halim at (60,47) outside the cottage and Dilara inside are within the engine's supported hearing distance. The room header lists occupants, while the conversation strip lists participants. This is not proof that sound crosses arbitrary walls; separate-room hearing remains blocked.

The rebuilt viewer was checked again at 390 × 844. The journal occupied exactly 390 × 844 with no document overflow. Closing it returned keyboard focus to Journal. The observed card layout retained the approved category colors and portrait album.

A final desktop check found the person action ring could overlap the dock. It now uses the existing measured safe insets, including the open journal’s width. Thirty focused layout tests cover the dock boundary, open/close and mobile transitions. A rebuilt desktop check showed all four Yusuf actions outside the journal; the exact near-edge clamp is covered by the regression.

At 390 × 844, a recorded indoor Dilara line at 06:54 wrapped into three readable lines within the viewport: “Then I’ll find iron, or carve a latch that doesn’t need it. I’m not sleeping in a passage forever.” The balloon stayed above its resident and below the room header. The temporary viewport override was reset afterward.
