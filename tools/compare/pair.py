"""Side-by-side (or stacked) comparison of before/after renders, optionally cropped and scaled.

    python tools/compare/pair.py out.png before.png after.png [--crop x0,y0,x1,y1] [--scale 0.5] [--stack]
"""
import sys
from PIL import Image

args = sys.argv[1:]
out, a, b = args[0], args[1], args[2]
crop = None
scale = 1.0
stack = '--stack' in args
if '--crop' in args:
    crop = tuple(int(v) for v in args[args.index('--crop') + 1].split(','))
if '--scale' in args:
    scale = float(args[args.index('--scale') + 1])
ims = [Image.open(p).convert('RGB') for p in (a, b)]
if crop:
    ims = [im.crop(crop) for im in ims]
if scale != 1.0:
    ims = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in ims]
w, h = ims[0].size
canvas = Image.new('RGB', (w, h * 2 + 6) if stack else (w * 2 + 6, h), (255, 255, 255))
canvas.paste(ims[0], (0, 0))
canvas.paste(ims[1], (0, h + 6) if stack else (w + 6, 0))
canvas.save(out)
print(out, canvas.size)
