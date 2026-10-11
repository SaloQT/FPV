"""Images side by side at a common scale: python tools/compare/row.py out.png scale a.png b.png [c.png ...]"""
import sys
from PIL import Image

out, scale, paths = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
ims = [Image.open(p).convert('RGB') for p in paths]
ims = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in ims]
w, h = ims[0].size
canvas = Image.new('RGB', (w * len(ims) + 6 * (len(ims) - 1), h), (255, 255, 255))
for i, im in enumerate(ims):
    canvas.paste(im, (i * (w + 6), 0))
canvas.save(out)
print(out, canvas.size)
