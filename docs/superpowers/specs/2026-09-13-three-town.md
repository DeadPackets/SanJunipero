# The full town in Three.js

The approved reference is the local `street-renderers/life` prototype. Keep its warm cream timber buildings, quiet light, grounded characters, soft shadows, living vegetation, and smooth occlusion relief. Apply this to the actual event-driven town, not a second simulation.

The exterior uses Three.js. The existing Pixi camera and reading layers remain the projection authority so director shots, anchored names, speech, replay, selection, broadcast, and the paper UI continue working. Existing furnished interior scenes remain available during the migration. Three.js observes WorldStore and the interpolated character poses. It must never send simulation commands.

Build structures from state footprints, facing, stage, and kind. Draw every authored and newly constructed kind, including bridges, lamps, fire pits, civic buildings, and farms. Terrain follows tile changes and map growth. Crops, dropped items, fauna and forage remain visible. Lights follow the shared flame law and weather follows the recorded state. Scene clocks obey pause and reduced motion.

Characters stand at tile centers, with clearance from walls. Preserve the engine's grid navigation and door access. Geometry must fit inside its occupied footprint. Do not enlarge blocked tiles and close existing one-tile lanes.

Art Forge keeps character and illustration work. Add a validated material-set manifest and local registration path for aligned base-color, normal, roughness, and emission PNGs. Existing PNG records remain valid. Read material maps in Three.js with correct color spaces. Do not invent a 3D-generation provider or run paid generation.

Keep production stopped. Do not write under data/. Do not read secrets. Do not run the whole test suite or knip. Run one vitest process at a time. Browser engine imports must use existing safe subpaths.
