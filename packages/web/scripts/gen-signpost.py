#!/usr/bin/env python3
# The signpost's rasters at native pixel size: chrome.css shows them at 2x (3x above 1920px), so
# one drawn pixel is always a whole number of screen pixels. Run from packages/web.
from PIL import Image

DEEP = (0x24, 0x1F, 0x2B, 255)
HONEY_L = (0xF8, 0xDC, 0xA2, 255)
HONEY = (0xF2, 0xC8, 0x79, 255)
WOOD_L = (0xE0, 0xA9, 0x5E, 255)
WOOD = (0xC6, 0x8A, 0x48, 255)
WOOD_D = (0xA6, 0x6E, 0x38, 255)
IRON = (0x85, 0x7D, 0x75, 255)
IRON_L = (0xCF, 0xC6, 0xBC, 255)
CLEAR = (0, 0, 0, 0)

W, H, TIP = 88, 18, 8  # plank; the point takes the last TIP columns
GRAIN = [(10, 3, 14), (30, 5, 9), (48, 3, 22), (18, 12, 11), (44, 13, 18), (66, 4, 7), (58, 11, 6)]


def plank(light, face, shade, dark, out):
    im = Image.new('RGBA', (W, H), CLEAR)
    px = im.load()
    for y in range(H):
        d = abs(y - (H - 1) / 2)
        right = W - 1 - int(d * (TIP - 1) * 2 / (H - 1))
        for x in range(0, right + 1):
            edge = y in (0, H - 1) or x == 0 or x == right
            c = DEEP if edge else light if y == 1 else shade if y >= H - 3 else face
            px[x, y] = c
    for x0, y, n in GRAIN:
        for x in range(x0, x0 + n):
            px[x, y] = dark if y < H // 2 else light
    for y in (5, 12):
        px[3, y] = IRON_L
        px[4, y] = IRON
        px[4, y + 1] = DEEP
        px[3, y + 1] = IRON
    im.save(out, lossless=True)


def post(out):
    im = Image.new('RGBA', (8, 16), CLEAR)
    px = im.load()
    for y in range(16):
        for x in range(8):
            px[x, y] = DEEP if x in (0, 7) else WOOD_L if x == 1 else WOOD_D if x == 6 else WOOD
    for x, ys in ((3, range(2, 7)), (4, range(9, 15)), (2, range(12, 14))):
        for y in ys:
            px[x, y] = WOOD_D
    im.save(out, lossless=True)


out = 'src/ui/px'
# the darker grain stays at 4.5:1 or better under deep ink; the pressed plank has no such tone
plank(HONEY, WOOD_L, WOOD, WOOD, f'{out}/signpost-arm.webp')
plank(HONEY_L, HONEY, WOOD_L, WOOD_L, f'{out}/signpost-arm-hot.webp')
plank(WOOD_L, WOOD, WOOD_D, WOOD_L, f'{out}/signpost-arm-on.webp')
post(f'{out}/signpost-post.webp')
print('signpost rasters written')
