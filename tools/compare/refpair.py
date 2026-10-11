"""Reference photo beside a render, both cropped to 16:9 and scaled to the same height.

    python tools/compare/refpair.py out.png ref.jpg render.png [render2.png ...]
"""
import sys
from PIL import Image

out, paths = sys.argv[1], sys.argv[2:]
H = 432
tiles = []
for p in paths:
    im = Image.open(p).convert('RGB')
    w, h = im.size
    if w / h > 16 / 9:
        nw = int(h * 16 / 9); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w * 9 / 16); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    tiles.append(im.resize((768, H), Image.LANCZOS))
c = Image.new('RGB', (768 * len(tiles) + 6 * (len(tiles) - 1), H), 'white')
for i, t in enumerate(tiles):
    c.paste(t, (i * 774, 0))
c.save(out)
print(out)
