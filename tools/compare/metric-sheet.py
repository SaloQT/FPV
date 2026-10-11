"""reference | before | after sheet with the audit's photo-match metrics (tools/audit/metrics.py) under each tile, one row per triple.
    python tools/compare/metric-sheet.py out.png ref1,before1,after1 [ref2,before2,after2 ...]   (paths relative to the current
    directory or absolute; ref may be '-')"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter

W, H = 640, 360

def metrics(im):
    # Same maths as tools/audit/metrics.py.
    a = np.asarray(im).astype(np.float64) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    luma = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    p5, p50, p95 = np.percentile(luma * 255, [5, 50, 95])
    mx, mn = a.max(-1), a.min(-1)
    sat = np.where(mx > 0.02, (mx - mn) / np.maximum(mx, 1e-6), 0).mean()
    rg, yb = a[..., 0] - a[..., 1], 0.5 * (a[..., 0] + a[..., 1]) - a[..., 2]
    colourful = np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean())
    ll = np.log(np.maximum(0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2], 1e-4))
    m = uniform_filter(ll, 9)
    local = np.sqrt(np.maximum(uniform_filter(ll * ll, 9) - m * m, 0)).mean()
    return f'p5/50/95 {p5:.0f}/{p50:.0f}/{p95:.0f} sat {sat:.2f} col {colourful:.3f} lc {local:.3f}'

def tile(path):
    if path == '-':
        return Image.new('RGB', (W, H)), ''
    p = path
    im = Image.open(p).convert('RGB')
    im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
    m = metrics(im)
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    if im.height > H:
        t = (im.height - H) // 2
        im = im.crop((0, t, W, t + H))
    return im, m

out, rows = sys.argv[1], [r.split(',') for r in sys.argv[2:]]
sheet = Image.new('RGB', (3 * W, len(rows) * (H + 18)), (0, 0, 0))
d = ImageDraw.Draw(sheet)
for r, row in enumerate(rows):
    for c, path in enumerate(row):
        im, m = tile(path)
        y = r * (H + 18)
        sheet.paste(im, (c * W, y))
        d.text((c * W + 4, y + H + 3), f'{["reference", "before", "after"][c]}  {os.path.basename(path)}  {m}', fill=(255, 255, 0))
        print(f'{r} {["ref", "before", "after"][c]:7s} {path:60s} {m}')
sheet.save(out)
