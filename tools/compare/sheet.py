"""Side-by-side sheet: reference photo | before | after, each scaled to one height, with labels.
Usage: python tools/compare/sheet.py out.png ref.jpg before.png after.png [--crop x0,y0,x1,y1 applied to before and after] [--height 540]"""
import sys
from PIL import Image, ImageDraw

args = sys.argv[1:]
crop = None; height = 540
if '--crop' in args:
    i = args.index('--crop'); crop = tuple(int(v) for v in args[i + 1].split(',')); del args[i:i + 2]
if '--height' in args:
    i = args.index('--height'); height = int(args[i + 1]); del args[i:i + 2]
out, *paths = args
labels = ['reference photo', 'before', 'after']
tiles = []
for k, p in enumerate(paths):
    im = Image.open(p).convert('RGB')
    if crop and k > 0: im = im.crop(crop)
    im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 8 * len(labels[k]) + 12, 22), fill=(0, 0, 0))
    d.text((6, 5), labels[k], fill=(255, 255, 255))
    tiles.append(im)
sheet = Image.new('RGB', (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), height), (0, 0, 0))
x = 0
for t in tiles:
    sheet.paste(t, (x, 0)); x += t.width + 8
sheet.save(out)
print(out, sheet.size)
