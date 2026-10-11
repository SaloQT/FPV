"""Contact sheet of the reference photos of one scene (a folder of tools/audit/refs), numbered, for picking a photo to match.
    python tools/audit/contact.py <scene>   ->  .bench/audit/contact-<scene>.png"""
import os, sys
from PIL import Image, ImageDraw

here = os.path.dirname(os.path.abspath(__file__))
scene = sys.argv[1]
d = os.path.join(here, 'refs', scene)
files = sorted([f for f in os.listdir(d) if f.endswith('.jpg')], key=lambda f: int(f.split('.')[0]))
tw, th = 400, 260
cols = 4
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th), (0, 0, 0))
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).convert('RGB')
    im.thumbnail((tw - 4, th - 4))
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(im, (x + 2, y + 2))
    ImageDraw.Draw(sheet).text((x + 8, y + 8), f, fill=(255, 0, 0))
out = os.path.join(here, '..', '..', '.bench', 'audit')
os.makedirs(out, exist_ok=True)
sheet.save(os.path.join(out, f'contact-{scene}.png'))
print(os.path.abspath(os.path.join(out, f'contact-{scene}.png')))
