# TWITCH READINESS — MEASURED, NOT ASSERTED

**U24.** The user acknowledged the gap and stated it plainly: *"it really feels a very far
distance from being that ready."* This document **measures the distance**. Every row carries a
measured value, including the rows that fail — a readiness report whose only content is passes
is not a measurement.

```
pnpm vitest run packages/web/src/ui/broadcastReady.test.ts   # R1/R3/R4/R5/R7/R8
pnpm vitest run packages/web/src/ui/broadcast.test.ts        # ★ R2, the broadcast layout
pnpm vitest run packages/web/src/ui/directorCut.test.ts      # R1's "no empty frame"
pnpm vitest run packages/web/src/render/scene.test.ts        # R1's "no error at load"
```

## The eight conditions

| id | requirement | measured | verdict |
|---|---|---|---|
| **R1** | ten unattended minutes with no empty frame, no error toast, no stalled camera | **the load-time `TypeError` is fixed and guarded** (`sceneClock`, reproduced then proved gone in the browser). **No empty frame:** `subjectFor` is now TOTAL over a living town — 200 consecutive ticks with `/api/heat` empty, 0 subject-less. **No stalled camera:** measured in the browser, viewport centre `(107, 343)` = the followed sprite's anchor `(107, 343)`, exactly. **The ten minutes themselves are not run.** | **OPEN — one human step** |
| **R2** | every caption legible at 1080p downscaled to a 480px mobile player | ★ **7.00 / 7.00 / 8.00 / 8.00 px against a 5.4 px floor**, at the true **0.25** scale, read off the shipped stylesheet. `captionShortfall` over the broadcast caption set is **`[]`**. Was 4.00 / 3.80 / 3.00 / 3.50. | **PASS** |
| **R3** | a viewer joining at any second understands who they are looking at within 10s | **the frame always names its subject** — the same totality as R1, and the name is 28 px / 7.00 px on the player. Before this batch the caption was absent for as long as the town stayed quiet, which was indefinitely. **Whether a stranger understands is a judgement.** | **OPEN — one human step** |
| **R4** | nothing on screen is a machine word, an id, or a number without a unit | **0 offenders** over a corpus of **90 strings**. Was 8. | **PASS** |
| **R5** | a death, a birth and a build each read differently without sound | **the necessary condition is measured and holds**: three distinct icons (`cross` / `spark` / `house`), three distinct pixel sets, three distinct sentences, three distinct timeline marks in kind, art and words. **One collision recorded:** `spark` is the birth glyph *and* the narrator milestone's, so a birth and a "first" share a picture — the sentence beside it separates them. **Whether they READ differently is a judgement.** | **OPEN — one human step** |
| **R6** | the frame rate holds ≥ 58fps for the whole ten minutes with everything live | **not measured, and not measurable from this lane.** Proved rather than assumed: `requestAnimationFrame` did not fire once in 45 s in the tab this batch worked in, which reported `document.visibilityState: 'hidden'` throughout. A frame rate read from a tab that is not painting is fiction. | **OPEN — one human step** |
| **R7** | no layout at 1280×800, 1440×900 or 1920×1080 clips, overlaps or scrolls horizontally | **stage 912 / 1072 / 1552 px** against a 640 px floor, **0 offenders**. In the broadcast frame the panel is gone, so the stage is the full width at all three. | **PASS** |
| **R8** | the stream survives a socket drop and a reconnect without lying about the clock | **verified in the browser:** the badge goes from `Now · Day 0 · 01:59` to **`Last seen · Day 0 · 01:59`**. And the word is now legible: it was `--cream` on `--rose` at **3.12:1** at 12.48 px, below AA; it is `--deep` at **4.82:1**. | **PASS** |

**5 of 8 pass. 0 fail. 3 need a person, and each is one named step.**

Batch 6 measured 3 passes, 1 measured failure and 4 unmeasured.

## ★ R2 — what closed it, and what did not

**The plan's 0.44 was the wrong number and it flattered us by 78%.** 0.44 is 480 ÷ 1080 — it
treats 1080 as the source *width*. "1080p" is **1920 × 1080**, so the scale is
**480 ÷ 1920 = 0.25**. The floor is **2% of frame height** (EBU-TT / BBC family), which at
480 × 270 is **5.4 px**, so a caption must be **22 px at source** to survive. Every figure below
is at 0.25. **The correction was kept; it is why the desktop still fails.**

### What does NOT close it

Raising the desktop's type. 22 px chrome on a 1920 stage is absurd for the person sitting in
front of it, and the desktop shortfall stays **pinned as a measurement, not a failure**:

| desktop caption | source px | at 0.25 | short by |
|---|---|---|---|
| speech bubble | 16 | 4.00 | 1.40 |
| director subtitle | 15.2 | 3.80 | 1.60 |
| director speaker name | 12 | 3.00 | 2.40 |
| filmstrip title | 14 | 3.50 | 1.90 |

### What does — a second composition, for a second audience

`packages/web/src/ui/broadcast.ts`. **A stream has no operator.** Nobody presses a lens tab,
drags a timeline or opens a postcard, and at 480 px none of those are legible anyway — a control
bar at 44 px an item is eleven 11 px smudges. So fourteen surfaces **leave the frame** rather
than shrinking inside it, each with its reason recorded and each proved hidden by the sheet:

> `.px-title` · `.lens-tabs` · `.link-pill` · `.status-strip` · `.control-bar` · `.hud-dock` ·
> `#panel-outlet` · `.timeline` · `.film-strip` · `.moment-player` · `.fps-overlay` ·
> `.scrub-banner` · `.room-card` · `.digest-scrim`

What is left is the picture and the two things a stranger arriving mid-stream needs:

| broadcast caption | source px | at 0.25 | floor 5.4 |
|---|---|---|---|
| the clock | 28 | **7.00** | ✓ |
| the speaker's name | 28 | **7.00** | ✓ |
| what they said | 32 | **8.00** | ✓ |
| a speech bubble in the world | 32 | **8.00** | ✓ |

**The bubble multiplier is 2, not 1.5.** The world's faces are nearest-sampled off an atlas
baked at 16 px, so only a whole multiple keeps one texel on one pixel; 1.5 would give the town
a caption with alternating one- and two-pixel strokes. Measured on the live canvas: a 33-
character line is **312 × 136** CSS px at a desk and **624 × 272** in a broadcast, a ratio of
**1.989** (the 0.011 is the nine-slice frame rounding to whole pixels).

**Two world captions are absent rather than enlarged, and both are measured, not assumed:**

- **name tags** are bound to `pointerover` in `characters.ts`, and an unattended broadcast has
  no pointer;
- **place-name plates** are `landmarkAlpha(scale) = 0` at and above 1×, and the broadcast sits
  at `DIRECTOR_ZOOM` = 3, so they are never in the frame at all.

### The composition, and what the browser caught in it

```
┌──────────────────────────────────────────────┐
│                          NOW · DAY 0 · 15:53 │  28px, on --night
├──────────────────────────────────────────────┤
│                                              │
│        the town at 3×, the auto-cut          │  the picture — and the
│        camera on whoever is the subject      │  canvas ENDS here
│                                              │
├──────────────────────────────────────────────┤
│                    AMARA                     │  28px --honey on --deep
│         "The fire pit is finished."          │  32px --cream on --deep
└──────────────────────────────────────────────┘
```

1. **★ It opened on grass.** `DirectorMode` pushed to 3× on mount, before the first heat poll
   had named anybody. With no subject the picture is the whole settlement now, and the push-in
   waits for somebody to push in on.
2. **★ A doubled bubble landed on the caption.** Two things a viewer must read, in one place.
   The stage now ends above the caption band, from one variable — `placeBubbles` clamps to
   `viewRect()`, which is the canvas — so nothing in the world can be drawn across the caption.
   **P19 applied to the stream frame.** Measured in the browser: canvas bottom 647, caption top
   647, **overlap 0**.
3. **The size looked wrong until it was looked at properly.** A 624 px bubble is 39% of a
   1600 px desktop and reads as enormous. On the frame downscaled to 480 — the actual viewing
   condition, and a downscale rather than a reflow, which is what a transcode does — it is a
   normal speech balloon and the clock, the bubble and the caption all read.

### What triggers it

**`?broadcast=1`, and nothing else.** That is the URL an OBS browser source is pointed at. It
is parsed in `parseRoute`, carried by `routeToPath` through every rewrite of the address bar
(a scrub calls `replaceState` once a sim minute and would otherwise drop it), and it makes the
route the televised town — `lens: 'director'`, no recorded day — because the auto-cut camera
and its caption *are* the layout rather than a decoration on one.

**It is never a viewport width.** A test walks every `@media` block in the sheet and fails if
any of them mentions `data-broadcast`, and forbids `innerWidth` / `matchMedia` / `clientWidth`
in the three files that could reach it. A layout with 32 px captions firing on a narrow desktop
window would be a regression for the ordinary viewer, who is sitting two feet from the screen.

## The human half — three steps, each one procedure

Three lines cannot be closed from this lane, and the reason is the same for all three: **a
background tab does not paint.** Proved, not assumed — `requestAnimationFrame` did not fire once
in 45 seconds in the tab this batch used, which reported `document.visibilityState: 'hidden'`
the whole time. Every canvas number in this report was taken by advancing the Pixi ticker by
hand and is stated as such.

**Before each run:** `pnpm --filter @sj/gateway dev:world` with `SJ_DEV_MAP=showcase`, then
`pnpm --filter @sj/web dev`. **The window must be frontmost and unoccluded for the whole run**
— if `document.visibilityState` is ever `'hidden'`, the run is void.

1. **R1 — ten unattended minutes.** Open `/?broadcast=1`, take your hand off the mouse, and
   leave it for 10:00 by a wall clock. **Record:** any second with no subject named in the
   caption; any console error; any second where the camera does not track the named subject.
   *Expected:* zero of each. The two failure modes that existed at the start of this batch —
   the load `TypeError` and the subject-less frame — are both fixed and both guarded by tests,
   so this run is a confirmation rather than a hunt.
2. **R3 — ten seconds to orient.** A person who has not seen the product opens `/?broadcast=1`
   and says, out loud, **who they are looking at and what that person is doing.** Record the
   wall-clock seconds. The name is answered by the caption; *what they are doing* is the half
   this run is really testing, because the caption says `…` until the subject speaks or thinks.
3. **R5 — three events without sound.** With the audio off, scrub to a death, a birth and a
   completed build and say which is which from the frame alone. The machine has already shown
   the three are pairwise distinct in icon, pixels, sentence and timeline mark; **the one thing
   to watch for is the recorded collision** — a birth and a narrator "first" share the `spark`
   glyph, so judge whether the sentence beside it is enough.
4. **R6 — the frame rate.** `FpsOverlay` on (`H` restores the chrome), everything live, 10:00
   foregrounded. **Record the median and the 1% low, not the mean.** Do it once on the ordinary
   layout and once on `/?broadcast=1`: the broadcast draws less chrome but its bubbles are 4×
   the area, and nobody has measured which way that lands.

## What was found and fixed on the way here

- **R1's load-time `TypeError`.** `Cannot read properties of null (reading 'start')` from
  `App.tsx`'s `scene.app.ticker.start()`. Reproduced exactly, then fixed: the scene answers
  `setTicking` and goes quiet once closed, StageMount hands its caller `null` in the same
  teardown that destroys the scene, and a scan keeps `.app.ticker` inside the renderer.
  **★ It is not StrictMode**, which the previous batch named — `main.tsx` renders `<App />`
  bare and StrictMode has never been in this tree. The double-mount is Vite Fast Refresh.
- **R1's empty frame.** The dev town ran 592 ticks with 0 words spoken, 0 deaths, 0 fires, and
  its eleven completed structures were all raised by `script`, so `/api/heat` was legitimately
  `[]` the whole time and the director had nobody to cut to. `quietSubject` turns a round of
  the town's inhabitants over one heat window at a time.
- **R8's own legibility.** `.tick-badge.stale` was `--cream` on `--rose` — **3.12:1** at
  12.48 px, below AA — on the one surface whose job is to say the clock is stale. `.link-pill`,
  wearing the same rose beside it, had the darker ink all along at 4.82:1.
- **R4, eight offenders** (previous batch): four producers printed the engine's raw kind, and
  the chronicle read *"The fire_pit is finished."* on screen.
