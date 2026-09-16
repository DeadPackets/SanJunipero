# Full town rendering

Three.js is the default exterior renderer. It reads the same WorldStore as the director, papers and replay controls. There is no second simulation and no new command channel. `?renderer=pixi` keeps the previous exterior available for comparison.

The shared camera transform drives both canvases. Three renders beneath a transparent Pixi canvas. Pixi keeps the existing text, speech, emotes, selection rings and furnished room scenes. The React interface, broadcast URL (`?broadcast=1`) and director remain connected to the existing scene handle.

## What follows the world

- Structures use their recorded footprint, facing, kind and construction stage. Art never enlarges the blocked area.
- Characters retain their event-driven paths and existing atlas poses. Exterior figures use the demo's 40-pixel height, while Pixi figures retain 52 pixels. Feet use tile centers. Crowd centers stay outside occupied plots, while the engine retains its grid paths and door access.
- Terrain rebuilds only changed 16 × 16 chunks, including their boundary halos. Material arrivals replace textures without replacing vegetation. Trees, grass, water and rocks cover the full map and follow growth and tile changes.
- Crops, dropped items and forage follow state. Fauna remains in the simulation but is hidden from the Three.js view. Approved item art remains available on upright textured planes, with simple geometry until it loads.
- Sun, moon and sky use the day clock. The demo's low, warm evening sun gives way to cool directional moonlight. Fuel state comes from `flamesAt`. Lamps and open fires provide real point lights at 8/12 power. Open fires take priority when the light pool is full. Fueled buildings glow through their windows. House interiors do not leak unshadowed point lights through their walls.
- Occluders fade with stable blending and depth writes, a 0.65-second hold, a 0.6-second fade and a 0.8-second restore. Point lights fade when entering or leaving the bounded light pool.

Character shadows use the visible atlas cutout. The invisible capsule is used only for picking. Sun/moon shadows use a 2-pixel filter radius, local lights use 3 pixels. Bloom strength is 0.08 with a 1.6 threshold, lamp emission is 1.4, and flames use normal alpha blending and tone mapping to retain their colour.

## Art Forge

See `../forge/MATERIALS.md` for the local import command. Material sets are additive metadata on existing asset records. Buildings consume `material:<building-kind>:wood` / `:roof`, falling back to `material:wood` / `material:roof`. Terrain consumes its existing `material:<terrain-kind>` records and aligned normal and roughness maps when present.

Base color and emission use sRGB. Normal and roughness use linear data. OpenGL normals and grayscale roughness are validated before registration. An emission map controls which pixels glow while that building is fueled. It does not create a light source in simulation. Terrain emission is not used.

## Current limits

Furnished room views still use Pixi. Characters and small authored items remain atlas art on upright planes. Buildings and vegetation use procedural meshes rather than generated GLB models. The renderer keeps eight local lights, with shadow maps on four, plus one shadow map shared by sun and moon. Terrain textures are at most 384 × 384 pixels per chunk per channel. No paid art generation is required.

The hybrid viewer uses two GPU contexts. The initial migration bundle measured 1,364.02 kB before gzip and 394.75 kB after gzip. Frame rate has not been benchmarked across hardware or map sizes.

## House C proportions

New towns and construction use a 3 × 3 house, cottage and storehouse, a 3 × 2 cabin and a 4 × 3 farmhouse (turned dimensions swap). The existing mesh style and heights remain. The grammar allows three tiles of depth and places plots at offsets 1 and 8, preserving streets, door access and unique work-site reach for houses. Door access uses recorded facing; records without facing retain the perimeter fallback.

Construction retains 2.5 wood and 720 ticks per tile. Houses and cottages therefore use 22.5 wood and 6,480 ticks, farmhouses 30 wood and 8,640 ticks. Scripted house construction retains its accelerated duration. The unfinished genesis farmhouse remains 1,440 ticks from completion. Room capacity follows the larger recorded area.

Existing event histories are not resized. The preview starts a separate town in `/tmp/sj-three-town/wide-town.db`, launched by `/tmp/sj-three-town/serve-wide.mjs`. The previous `world.db` is retained. Before resuming an existing production town, preserve or explicitly migrate its construction configuration: old unfinished buildings read configured build durations. No production migration is included here.

## Earlier demo parity correction

The first migration inset house walls by 0.22 tiles and retained the larger Pixi figure scale. Walls now fill 94% of a two-tile plot, about 21% more width and depth. The farmhouse regains its taller second floor, hipped roof, two chimneys and wood relief. Fire rings scale to their recorded footprint, with embers and smoke. Geometry remains inside occupied ground.

The scripted stream now asks its existing lamplighter for 16 posts rather than 8. Posts still use build/stoke events, stay off roads and keep doors accessible. `SJ_LAMPS` overrides this target. This does not instruct live minds to build lamps.

## Checks

Run targeted tests, one Vitest process at a time:

```sh
pnpm exec vitest run packages/web/src/render/three packages/web/src/browserGraph.test.ts --poolOptions.forks.maxForks=1 --silent=true
npm run -s typecheck
pnpm --filter @sj/web build
```

The production town stays stopped. The local review server uses a separate database under `/tmp/sj-three-town`, never `data/`.

### Soft character light and scene weather

The selected B treatment uses the existing character atlas for a small emissive fill (0.1 at night, 0.2 in daylight). Characters still receive scene lighting and object shadows. No alternate character art or walking atlas was introduced.

`three/weather.ts` owns rain, snow and ground ripples. These are depth-tested scene objects. Building bounds exclude precipitation below occupied roofs and prevent ground ripples within buildings. Weather uses the frame clock, so precipitation continues while a recorded moment is held. It hides indoors and omits motion and lightning under reduced motion. Grave story tone does not hide Three precipitation. The old Pixi weather remains only in the Pixi renderer.

New building materials arrive through `material:<kind>:wood` and `material:<kind>:roof`. The existing form and recorded footprint stay fixed. A material set is applied only when all of its maps load, with bounded download retries and disposal guards.
