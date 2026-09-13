# Full town rendering

Three.js is the default exterior renderer. It reads the same WorldStore as the director, papers and replay controls. There is no second simulation and no new command channel. `?renderer=pixi` keeps the previous exterior available for comparison.

The shared camera transform drives both canvases. Three renders beneath a transparent Pixi canvas. Pixi keeps the existing text, speech, emotes, selection rings and furnished room scenes. The React interface, broadcast URL (`?broadcast=1`) and director remain connected to the existing scene handle.

## What follows the world

- Structures use their recorded footprint, facing, kind and construction stage. Art never enlarges the blocked area.
- Characters retain their event-driven paths and existing atlas poses. Feet use tile centers. A 0.7-tile presentation clearance keeps crowd offsets outside inset walls, while the engine retains its grid paths and door access.
- Terrain rebuilds only changed 16 × 16 chunks, including their boundary halos. Material arrivals replace textures without replacing vegetation. Trees, grass, water and rocks cover the full map and follow growth and tile changes.
- Crops, dropped items, fauna and forage follow state. Approved item art remains available on upright textured planes, with simple geometry until it loads.
- Sun and sky use the day clock. Fuel state comes from `flamesAt`. Lamps and open fires provide real point lights. Fueled buildings glow through their windows. House interiors do not leak unshadowed point lights through their walls.
- Occluders fade with stable blending and depth writes, a 0.65-second hold, a 0.6-second fade and a 0.8-second restore. Point lights fade when entering or leaving the bounded light pool.

## Art Forge

See `../forge/MATERIALS.md` for the local import command. Material sets are additive metadata on existing asset records. Buildings consume `material:<building-kind>:wood` / `:roof`, falling back to `material:wood` / `material:roof`. Terrain consumes its existing `material:<terrain-kind>` records and aligned normal and roughness maps when present.

Base color and emission use sRGB. Normal and roughness use linear data. OpenGL normals and grayscale roughness are validated before registration. An emission map controls which pixels glow while that building is fueled. It does not create a light source in simulation. Terrain emission is not used.

## Current limits

Furnished room views still use Pixi. Characters and small authored items remain atlas art on upright planes. Buildings and vegetation use procedural meshes rather than generated GLB models. The renderer keeps eight local lights, with shadow maps on two, plus one sun shadow map. Terrain textures are at most 384 × 384 pixels per chunk per channel. No paid art generation is required.

The hybrid viewer uses two GPU contexts. The production bundle measured 1,364.02 kB before gzip and 394.75 kB after gzip. One review frame reported 737 draw calls across all Three passes. These are observations, not a frame-rate guarantee for other hardware or map sizes.

## Checks

Run targeted tests, one Vitest process at a time:

```sh
pnpm exec vitest run packages/web/src/render/three packages/web/src/browserGraph.test.ts --poolOptions.forks.maxForks=1 --silent=true
npm run -s typecheck
pnpm --filter @sj/web build
```

The production town stays stopped. The local review server uses a separate database under `/tmp/sj-three-town`, never `data/`.
