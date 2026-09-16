# Product

## Register

product

## Users

People watching a simulated town, including casual viewers and broadcast audiences. They come to observe people, relationships, places and events, and need clear ways to learn more without losing their place in the town.

## Product Purpose

San Junipero is an autonomous town whose facts are recorded as replayable events. The viewer makes those lives understandable. The engine defines physics rather than social outcomes. Watching and reading must not issue instructions to minds.

## Brand Personality

Quiet, playful, humane. Icons should be flat, filled and colored to match the interface. The owner rejected textured, dimensional fantasy inventory artwork and the earlier sketch-like SVG icons. Preserve the familiar town character while making the interface readable and easy to use. The owner prefers the existing design, refined rather than replaced with an unrelated aesthetic.

## Anti-references

Dense operator screens presented to casual viewers, unclear controls, repetitive event summaries, empty default pages when useful content exists, and decoration that obscures reading.

## Design Principles

1. The town remains the main experience. Details support observation.
2. Start with useful facts and reveal secondary detail when requested.
3. Make people, places and recorded moments easy to find and follow.
4. Keep operator actions separate from the town's own agreements.
5. Show only supported facts. Never turn missing history into a claim about what happened.

## Accessibility & Inclusion

Use readable body text, clear contrast, keyboard controls, visible focus, reduced-motion support and responsive panels. The owner specifically asks for accessible, smooth interaction and low cognitive load. No formal conformance certification is claimed.

## Approved design and integration

The owner approved the game edition on 2026-09-14 and requested integration into San Junipero. The live React paper uses the approved flat raster icons, colored character cards, wellbeing gauges, milestone medals and a browser-only notebook. Folk offers Everyone and Following; profiles offer Now, Relationships and History. Chronicle offers Catch up, Timeline and Firsts. Land offers Places and Discoveries. Rule offers Agreements, Milestones and How it works. Extended records and operator controls remain secondary.

The four category colors are coral, gold, sage and slate blue. All four category buttons always carry their own category color. The strip behind them, its grip and the panel border match the open category; an inset underline marks the selected tab. These colors, inner tabs, panel accents and a light reading-surface tint fade over 220 ms. Reduced-motion mode changes them immediately. Unfollowed stars are dim grey; followed stars are gold. The top day bar spans the full window even when a panel is docked.

All integrated data comes from WorldStore or the existing read-only endpoints. Skill XP is real; numeric character levels are not invented. Missing histories stay empty. Latest-only mind and bond documents are withheld during replay. Building images are cached snapshots rendered from the actual Three.js scene, including its geometry and materials. No sample story, law or milestone data from the prototype is used.

The approved standalone study remains at http://127.0.0.1:8772/game/. The earlier calm examples remain at `/quiet/` and `/refined/`. The full local integrated UI is served at http://127.0.0.1:8768/. AI minds remain off. Production deployment is a separate step.
