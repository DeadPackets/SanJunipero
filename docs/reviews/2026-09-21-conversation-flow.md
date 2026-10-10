# Conversation flow follow-up

Local branch: `codex/sanjunipero-v3`. Production is unchanged. No inference calls were made for this follow-up.

## Decisions

Keep the approved town, pixel balloons and paper palette. A conversation gets one shared in-town caption and a ring beneath each visible participant. The cue remains between replies. The displayed speaker gets a solid bright ring; listeners get dashed rings. No invented dialogue, emotions or model-thinking claims are added. Three disposable cue studies compared the shared caption, individual labels and a ground connection; the shared caption avoids repeated labels and path-like decoration.

Speech gets a minimum reading window of 1.4–6 seconds, based on word count, before another line replaces it. The waiting queue holds at most two lines to avoid trailing far behind the world; complete public lines remain in the transcript. Speech interrupts thoughts. Unrelated speech cannot interrupt the focused conversation. Indoor speech follows a visible room conversation even when the director cuts elsewhere.

## Changes

1. Add conversation presence through opening, reply gaps, speaker handoff and a one-second ending fade. Respect dock bounds, room visibility, sleepers, pause and reduced motion.
2. Preserve a closing line through natural completion. Clear stale presentation on forward/backward replay resets and room changes. Keep current speech readable when paused.
3. Turn idle, awake indoor residents toward visible conversation partners. Movement, sleep and work keep their existing behavior.
4. Emit `scene_ended` when the coordinator actually ends the exchange. Release the speaker while the existing summary call finishes. Track that pending work for shutdown. The later `scene_closed` still carries the real summary, relationships and council outcome.
5. Close the gateway relay and director's active scene immediately, including reconnect/replay. Retain later summary scoring. Clear tension at the same lifecycle boundary.

## Verification

Regression tests cover the deferred summary provider, immediate websocket ending, late summary enrichment, director restart, indoor facing, persistent markers, speaker visibility, departing participants, reading windows, bounded queues, final words, pause and replay resets.

Browser review used the recorded real-mind day on port 8776, with inference disabled. The old cottage exchange showed the caption and rings between replies, then the complete Dilara balloon with the speaker ring. The room contains Dilara and later Halim; Tariq remains asleep without a conversation ring. At 390 × 844 the cue fits within the town view. On desktop it stays left of the docked Folk journal. The temporary viewport override was reset. No browser errors were observed; the existing Pixi warning remains.

## Limits

This improves conversation visibility and removes the summary wait from the end of a turn. It does not claim to eliminate model response latency or improve the content of already-recorded conversations. The earlier streaming probe remains inconclusive and streaming adoption is deferred. The recorded day cannot demonstrate the new backend end event; deferred-provider and websocket tests cover it directly.

Final validation: 8,882 tests passed across 538 files. Typecheck, ESLint, repository formatting and Knip passed, as did the Vite production build. Existing lint warnings and the existing large-chunk build warning remain. Local ports 8774 (scripted town) and 8776 (recorded real-mind day) serve the rebuilt client.
