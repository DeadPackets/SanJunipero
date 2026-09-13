# Local material sets

Import authored PNG maps into a local Forge database. This path makes no network calls and costs $0.

From the repository root:

```sh
pnpm exec tsx packages/forge/scripts/import-material-set.ts \
  /tmp/town-materials.db wood /absolute/path/wood-base.png \
  --normal /absolute/path/wood-normal.png \
  --roughness /absolute/path/wood-roughness.png \
  --emissive /absolute/path/wood-emissive.png
```

The first three arguments are the database path, material kind, and base color PNG. All flags are optional. Use `--class terrain` for ground materials. The default class is `building`. Import into a copy of the local town database to make these records available through its existing asset gateway. A separate database does not merge itself into a running town.

| Map | Required | Meaning |
|---|---|---|
| Base color | Yes | sRGB RGB color with optional alpha |
| Normal | No | Opaque tangent-space RGB, OpenGL positive Y, linear data |
| Roughness | No | Opaque grayscale, 0 smooth to 255 rough, read from green, linear data |
| Emissive | No | sRGB RGB emission color with optional alpha |

All maps must have identical width and height. PNGs must contain one 8-bit image. Normal pixels must encode unit vectors within 0.15 and face the positive Z hemisphere. The importer can validate that encoding but cannot detect an artist's inverted Y convention. Supply OpenGL maps. Roughness RGB channels must be equal. The importer does not resize, quantize, flip, or change source bytes.

All files and pixels are validated before the first asset is registered. Every import allocates fresh asset IDs. Earlier records and map bytes stay unchanged. Optional maps may be absent. The viewer uses its ordinary material values for absent maps.

Map records use the existing asset class with kinds `material-map:<kind>:<channel>`. After their registration, a final record uses kind `material:<kind>`. Its PNG contains the base color and its metadata contains the strict versioned manifest below. A renderer resolves each `assetId` through the existing `/assets/<id>.png` route. Legacy metadata parses as `null`.

```json
{
  "version": "v1-material-set",
  "kind": "wood",
  "widthPx": 512,
  "heightPx": 512,
  "maps": {
    "baseColor": {
      "assetId": "asset_01234567-89ab-4cde-8fab-0123456789ab",
      "colorSpace": "srgb"
    },
    "normal": {
      "assetId": "asset_11234567-89ab-4cde-8fab-0123456789ab",
      "colorSpace": "linear",
      "convention": "opengl"
    },
    "roughness": {
      "assetId": "asset_21234567-89ab-4cde-8fab-0123456789ab",
      "colorSpace": "linear",
      "channel": "g"
    },
    "emissive": {
      "assetId": "asset_31234567-89ab-4cde-8fab-0123456789ab",
      "colorSpace": "srgb"
    }
  }
}
```

Check the printed material record ID and map IDs after the command completes. Each record books zero cost. The command imports image assets only and does not change town events.
