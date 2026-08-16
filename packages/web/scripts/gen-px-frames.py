# Generates the 9-slice pixel frame art + dither grain for the observatory chrome.
# Run: uv run --with pillow scripts/gen-px-frames.py   (from packages/web)
# All colors are the town master palette; art is on a 2px pixel grid, drawn 1:1
# so border-image never rescales it (slice == border-width).
from PIL import Image, ImageDraw

INK = (0x43, 0x39, 0x4A, 255)
DEEP = (0x24, 0x1F, 0x2B, 255)
NIGHT = (0x32, 0x2B, 0x38, 255)
CREAM = (0xFF, 0xF6, 0xE9, 255)
PARCH = (0xF6, 0xE8, 0xD5, 255)
SAND = (0xE8, 0xD5, 0xBC, 255)
HONEY = (0xF2, 0xC8, 0x79, 255)
HONEY_L = (0xF8, 0xDC, 0xA2, 255)
HONEY_D = (0xD9, 0xA4, 0x5B, 255)
CLEAR = (0, 0, 0, 0)


def px(d, x, y, c, s=2):
    d.rectangle([x, y, x + s - 1, y + s - 1], fill=c)


def ring(img, inset, color):
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rectangle([inset, inset, w - 1 - inset, h - 1 - inset], outline=color, width=2)


def notch_corners(img, cell=2):
    # outer 2x2 corners transparent + ink step one cell in: pixel-rounded corners
    d = ImageDraw.Draw(img)
    w, h = img.size
    for cx, cy in [(0, 0), (w - cell, 0), (0, h - cell), (w - cell, h - cell)]:
        px(d, cx, cy, CLEAR, cell)
    sx = {0: cell, w - cell: w - 2 * cell}
    sy = {0: cell, h - cell: h - 2 * cell}
    for cx, cy in [(0, 0), (w - cell, 0), (0, h - cell), (w - cell, h - cell)]:
        px(d, sx[cx], sy[cy], INK, cell)


def bevel(img, inset, light, shade):
    d = ImageDraw.Draw(img)
    w, h = img.size
    d.rectangle([inset, inset, w - 1 - inset, inset + 1], fill=light)            # top
    d.rectangle([inset, inset, inset + 1, h - 1 - inset], fill=light)            # left
    d.rectangle([inset, h - 2 - inset, w - 1 - inset, h - 1 - inset], fill=shade)  # bottom
    d.rectangle([w - 2 - inset, inset, w - 1 - inset, h - 1 - inset], fill=shade)  # right


def frame(fill, light, shade, outline=INK, size=30):
    img = Image.new('RGBA', (size, size), fill)
    ring(img, 0, outline)
    bevel(img, 2, light, shade)
    notch_corners(img)
    return img


def frame2(fill, light, shade, keyline=INK, size=36):
    # ceremonial double-line frame: ink, fill gap, inner keyline, bevel, fill
    img = Image.new('RGBA', (size, size), fill)
    ring(img, 0, INK)
    ring(img, 4, keyline)
    bevel(img, 6, light, shade)
    notch_corners(img)
    return img


def dither(base_alpha=10, size=8):
    img = Image.new('RGBA', (size, size), CLEAR)
    d = ImageDraw.Draw(img)
    grain = (0x43, 0x39, 0x4A, base_alpha)
    px(d, 0, 0, grain)
    px(d, 4, 4, grain)
    return img


out = 'src/ui/px'
frame(PARCH, CREAM, SAND).save(f'{out}/frame-parchment.png')
frame(CREAM, (255, 255, 252, 255), SAND).save(f'{out}/frame-cream.png')
frame(HONEY, HONEY_L, HONEY_D).save(f'{out}/frame-honey.png')
frame(DEEP, (0x3A, 0x33, 0x46, 255), (0x17, 0x13, 0x1E, 255), outline=SAND).save(f'{out}/frame-night.png')
frame2(PARCH, CREAM, SAND).save(f'{out}/frame2-parchment.png')
dither().save(f'{out}/dither-warm.png')
print('px frames written')
