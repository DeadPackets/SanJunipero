# Run: uv run --with pillow scripts/gen-favicon.py   (from packages/web)
from PIL import Image

INK = {
    ".": "#322B38",
    "H": "#F8DCA2",
    "P": "#E0A85A",
    "I": "#43394A",
    "S": "#7E512B",
    "W": "#4A2F1A",
}

# Two squares of margin all round: iOS rounds an apple-touch icon by about a fifth.
ART = [
    "................",
    "................",
    "................",
    "................",
    "...HHHHHHHHHH...",
    "...PPPPPPPPPP...",
    "...PIIPIIPIPP...",
    "...PPPPPPPPPP...",
    "...PPPPPPPPPP...",
    "...SSSSSSSSSS...",
    ".......SW.......",
    ".......SW.......",
    ".......SW.......",
    ".......SW.......",
    "......WWWW......",
    "................",
]
N = len(ART)


def rgb(hex_):
    return tuple(int(hex_[i : i + 2], 16) for i in (1, 3, 5))


def png(size, path):
    """Nearest-neighbour at every size, so a pixel stays a pixel."""
    img = Image.new("RGB", (N, N))
    img.putdata([rgb(INK[ch]) for row in ART for ch in row])
    img.resize((size, size), Image.NEAREST).save(path)


def svg(path):
    """The same grid as vector, one rect per run, crisp on any display."""
    rects = []
    for y, row in enumerate(ART):
        x = 0
        while x < N:
            ch = row[x]
            w = 1
            while x + w < N and row[x + w] == ch:
                w += 1
            if ch != ".":
                rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{INK[ch]}"/>')
            x += w
    body = "".join(rects)
    with open(path, "w") as f:
        f.write(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" '
            f'shape-rendering="crispEdges">'
            f'<rect width="{N}" height="{N}" fill="{INK["."]}"/>{body}</svg>\n'
        )


svg("public/favicon.svg")
png(32, "public/favicon-32.png")
png(180, "public/apple-touch-icon.png")
png(512, "public/icon-512.png")
