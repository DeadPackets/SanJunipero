# TWITCH READINESS — MEASURED, NOT ASSERTED

**U24.** The user acknowledged the gap and stated it plainly: *"it really feels a very far
distance from being that ready."* This document **measures the distance**. Every row carries a
measured value, including the rows that fail — a readiness report whose only content is passes
is not a measurement.

```
pnpm vitest run packages/web/src/ui/broadcastReady.test.ts    # the machine-checkable half
pnpm vitest run packages/web/src/ui/finish.test.ts            # the twelve finish lines
pnpm vitest run packages/web/src/ui/motion.test.ts packages/web/src/ui/sceneTransition.test.ts
```

## The eight conditions

| id | requirement | measured | verdict |
|---|---|---|---|
| **R1** | ten unattended minutes with no empty frame, no error toast, no stalled camera | **not run for ten minutes.** In ~40 minutes of driven use across this batch the console carried **zero uncaught exceptions** after the two found and fixed below. The protocol is in §Human half. | **OPEN — unmeasured** |
| **R2** | every caption legible at 1080p downscaled to a 480px mobile player | **4.00 / 3.80 / 3.00 / 3.50 px against a 5.4 px floor.** Scale is **0.25** (480 ÷ 1920), not the plan's 0.44 — see §The plan's scale factor. The smallest source size that survives is **22 px**; every caption in the product is 12–16 px. | **OPEN — by 1.4–2.4 px** |
| **R3** | a viewer joining at any second understands who they are looking at within 10s | not machine-decidable. The affordances that answer it are landed and named in §Human half. | **OPEN — unmeasured** |
| **R4** | nothing on screen is a machine word, an id, or a number without a unit | **0 offenders** over a corpus of **90 strings** from the chronicle, the important feed, hover tags, door tags, roster places and states, all world-law copy, every empty state and every control label. **Was 8** — the chronicle read *"The fire_pit is finished."* on screen. | **PASS** |
| **R5** | a death, a birth and a build each read differently without sound | not machine-decidable. Three distinct glyphs, three distinct sentences and three distinct feed classes exist (`death`, `done`, `fire`); whether they READ differently is the human half. | **OPEN — unmeasured** |
| **R6** | the frame rate holds ≥ 58fps for the whole ten minutes with everything live | **not measured.** A frame rate read from a background tab is not a frame rate (MEASUREMENT LAW), and this batch had no ten-minute foreground window. `FpsOverlay` exists for the protocol run. | **OPEN — unmeasured** |
| **R7** | no layout at 1280×800, 1440×900 or 1920×1080 clips, overlaps or scrolls horizontally | **stage 912 / 1072 / 1552 px** with the panel open (panel 368 px, read off the sheet), against a 640 px floor; the widest control bar needs 484 px and the filmstrip needs 336 px for two postcards. **0 offenders.** | **PASS** |
| **R8** | the stream survives a socket drop and a reconnect without lying about the clock | **verified in the browser:** the gateway was killed and the badge went from `Now · Day 0 · 01:59` to **`Last seen · Day 0 · 01:59`** in rose, beside `Reaching the town…`. **Audit M9 closed.** | **PASS** |

**3 of 8 pass. 1 is measured and fails. 4 are unmeasured and need a person.**

## The plan's scale factor is wrong, and it flatters us by 78%

The plan specifies "a computed minimum caption size at a **0.44** scale factor". 0.44 is
480 ÷ 1080 — it treats 1080 as the source **width**. "1080p" is **1920 × 1080**, and the mobile
player is 480 px **wide**, so the scale is **480 ÷ 1920 = 0.25**. Every caption figure in this
report is **56% of what the plan's factor would have reported**, and the difference is the
whole distance between "borderline" and "unreadable".

The floor is **2% of frame height** (EBU-TT / BBC subtitle guidance), which at 480 × 270 is
**5.4 px** — a fraction of the frame rather than a fixed pixel count, because that is the
quantity that survives a re-encode.

| caption | source px | at 0.25 | floor | |
|---|---|---|---|---|
| speech bubble | 16 | 4.00 | 5.4 | short by 1.40 |
| director subtitle | 15.2 | 3.80 | 5.4 | short by 1.60 |
| director speaker name | 12 | 3.00 | 5.4 | short by 2.40 |
| filmstrip title | 14 | 3.50 | 5.4 | short by 1.90 |

**No token fixes this.** 22 px chrome on a 1920 stage is absurd, and raising the bubble alone
leaves the subtitle behind. The answer is a **broadcast layout** — a mode that renders the
chrome at a larger logical size while the town keeps its own scale — which this batch does not
build. The shortfall is pinned exactly in `broadcastReady.test.ts`, so any change to a caption
size moves the number rather than silently passing.

## The human half — the protocol, run at G12b

Four lines need a person watching. Each is a fixed procedure so two runs compare.

1. **R1 — ten unattended minutes.** Start the dev world, open the town lens at the 1× stop,
   leave the pointer off the window for 10:00 by a wall clock. Record: any frame with nothing
   moving, any console error, any second where the camera does not track a followed body.
   *A background tab does not paint — the window must stay foregrounded, or the run is void.*
2. **R3 — ten seconds to orient.** A person who has not seen the product opens it and says who
   they are looking at and what that person is doing. Record the wall-clock seconds.
3. **R5 — three events without sound.** Scrub to a death, a birth and a completed build with
   the audio off, and record whether the viewer can tell them apart from the frame alone.
4. **R6 — the frame rate.** `FpsOverlay` on, everything live (bubbles, weather, the moments
   filmstrip), 10:00 foregrounded. Record the median and the 1% low, not the mean.

## What was found and fixed on the way here

- **R4, eight offenders.** `chronicleFormat.ts`, `importantFeed.ts`, `interaction.ts` and the
  gateway's `narratorApi.ts` all printed the engine's raw kind. `place.ts` had written the rule
  down years of tasks ago — *"a kind is a slug in the engine and prose here — the underscore
  never reaches a viewer"* — and four other producers did not apply it. `kindWords` is the one
  owner now.
- **R8, audit M9.** The tick badge read `Now` in its live colour with the socket down. The
  state is a pure function of `(link, live, awake)`, and the word comes from it.
