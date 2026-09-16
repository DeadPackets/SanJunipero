# Rear walking pose repairs

## Amara passing poses

`amara-passing-atlas.webp` is installed in `cast/amara/atlas.webp`. Original passing-a/b-ne/nw showed her FRONT while the rest of the rear cycle showed her back. The four replacement cells now use the correct rear passing pose and its mirror. The other 20 cells and all manifest anchors are unchanged. `amara-original.webp` preserves the starting atlas.

Built-in imagegen prompt: edit original rear idle, using original rear contact as a second reference, into one neutral passing step. Preserve Amara's black-brown low bun, blue hip-length jacket, cream shirt, ochre satchel/diagonal back strap, dark plum trousers, brown shoes, head size and torso proportions. Face diagonally away toward screen left, never toward the viewer. One foot supports her under the pelvis; the other passes close to the supporting ankle. Keep arms near her sides, original coarse pixel clusters and original colors. Single complete sprite on flat #FF00FF, no floor, shadow, text or checkerboard.

The import uses 54 colors sampled from her original rear idle/contact frames and a 248-pixel figure height on the existing 256-pixel cell. Source: `amara-passing-source.png`. Processed cell: `amara-passing-ne.png`. Both rear cycles were visually inspected in the house study and the served local asset was compared with the committed atlas.

## Nadia contact proportions

Current Nadia repair: `nadia-proportions-atlas.webp`, also installed in `cast/nadia/atlas.webp`. This supersedes `nadia-atlas.webp`. The earlier color correction still shortened the torso and made the head too small. Do not repack Nadia from the earlier source.

The new built-in imagegen edit used the original northeast contact-a and passing-b cells as references. Prompt: preserve the original head, braid, torso length, waist height, palette and rear three-quarter perspective; change the legs to the opposite diagonal contact step and use small arm counter-swing. Keep the head about 28% of figure height and the waistband about 61% down from the crown. A second background-only edit replaced the generated checkerboard with flat magenta for chroma-key import.

The import uses 45 colors sampled from Nadia's untouched frames, a 245-pixel figure height matching contact-a, and the existing 256-pixel canvas/feet anchor. Only `contact-b-ne` and its mirrored `contact-b-nw` differ from the original atlas. `nadia-proportions-source.png` and `nadia-proportions-contact-b-ne.png` preserve the source and processed cell. The rest of this document describes the earlier repair.

Nadia and Yusuf's second rear contact frames changed the body perspective and spread the limbs while the head retained the three-quarter angle. The owner reported both, and supplied a screenshot of Nadia's northeast/northwest contact pose.

The built-in imagegen tool produced new northeast contact poses. Existing Forge chroma key, palette quantization, height normalization, anchoring and mirror functions prepare them for the atlas. The northwest pose is the horizontal mirror. All other atlas cells and all manifest coordinates are retained.

Sources are saved beside this document. `*-contact-b-ne.png` is the processed cell; `*-atlas.webp` is the packed result. Original atlases are preserved in the local design study's assets. The live renderer also uses an accumulated walk cycle so incoming cadence changes cannot rewind its current animation phase.

Final generation prompts:

- Nadia: Repair the rear three-quarter contact-b-ne pose of the supplied Nadia atlas. Keep her auburn braid, sage vest, cream sleeves, charcoal trousers, brown boots, proportions and pixel-art identity. Align head, shoulders and pelvis diagonally away toward screen left. Use a natural opposite contact step and counter-swinging arms close to the torso. Avoid the symmetrical spread-eagle pose. Full figure, no floor or text. The initial output included a painted checkerboard; a second background-only edit requested solid #FF00FF while preserving the figure, for the existing chroma-key importer.
- Yusuf: Repair contact-b-ne of the supplied Yusuf atlas. Match rear idle and first contact: grey hair, brown-grey jacket, mustard trousers, tool belt, brown boots and dark pixel outlines. Align head, shoulders, pelvis and feet diagonally away toward screen left. Natural short opposite contact step and close counter-swinging arms; no twisted neck or front-facing shoulders. Keep the stocky adult proportions and chunky pixel style. Full figure on flat #FF00FF, no shadow, floor or text.

Review: http://127.0.0.1:8772/homes/ contains the original and repaired walk cycles, four directions, pause and single-pose stepping.


## Palette correction

The owner found a color shift in the northeast/northwest repair frames. The initial importer used the generic town palette; original character atlases contain their own colors. The corrected import keys the original generation, cleans the matte, then quantizes against representative colors sampled from that resident's original northeast idle, first contact and passing frames. There are 45 selected colors for Nadia and 53 for Yusuf. Height, anchor, repaired pose and mirror derivation are unchanged. The packed files and live cast now contain this correction. Do not rerun the initial generic-palette packer.


## Nadia rear direction mapping — 2026-09-16

The approved atlas's third row faces screen-left (NW) and fourth row faces screen-right (NE). Its manifest had those directions reversed. The current `cast/nadia/manifest.json` swaps NE/NW references for idle and the four walking poses. Sleep cells, image bytes, palette, dimensions and anchors are unchanged. Previous repair filenames refer to the old row labels; do not infer screen-facing direction from those filenames.


## Amara and Yusuf rear direction mapping — 2026-09-17

Both approved atlases use row 512 for screen-left NW and row 768 for screen-right NE. Their manifests now swap idle and all four walking cells between those directions, matching the Nadia correction. Sleep cells, image bytes, dimensions, palette and anchors are unchanged. The local review service registered both corrected manifests; isolated direction previews use those actual registered assets.
