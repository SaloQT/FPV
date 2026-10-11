"""Photo-match metrics for the realism audit: each render beside its reference photo, with luma p5/p50/p95, saturation, colourfulness and
local contrast, plus a side-by-side sheet. Run from the repo root:
    python tools/audit/metrics.py [world-run [track-run [tag]]]   (default audit-world audit-track; tag names the outputs)
The runs are tools/lightcast/measure.mjs output folders under .bench/lightcast/ (their <view>-extreme-<hour>-real.png); the photos are
tools/audit/refs/. Writes .bench/audit/metrics<tag>.json and .bench/audit/audit-sheet<tag>.png."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import uniform_filter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
LC = os.path.join(ROOT, '.bench', 'lightcast')
OUT = os.path.join(ROOT, '.bench', 'audit')
# render view -> (world run, reference photo)
PAIRS = [
    ('lone', 'audit-world', 'meadow-lone-tree/3.jpg'),
    ('far-edge', 'audit-world', 'meadow-lone-tree/7.jpg'),
    ('edge', 'audit-world', 'forest-edge/2.jpg'),
    ('interior', 'audit-world', 'forest-interior/0.jpg'),
    ('interior', 'audit-world', 'forest-interior/5.jpg'),
    ('bark-birch-10m', 'audit-world', 'forest-interior/2.jpg'),
    ('conifers', 'audit-world', 'conifers/5.jpg'),
    ('oak-20m', 'audit-world', 'oak-crown/1.jpg'),
    ('distant', 'audit-world', 'aerial/0.jpg'),
    ('flyover', 'audit-track', 'track-aerial/7.jpg'),
    ('gate-3', 'audit-track', 'forest-edge/2.jpg'),
]
GOLDEN = 'golden-hour-meadow/3.jpg'
HOURS = ['7', '12', '18.8']
RUNS = {'audit-world': sys.argv[1] if len(sys.argv) > 1 else 'audit-world', 'audit-track': sys.argv[2] if len(sys.argv) > 2 else 'audit-track'}
TAG = sys.argv[3] if len(sys.argv) > 3 else ''

def load(path, width=960):
    im = Image.open(path).convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    return im

def metrics(im):
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
    return {'p5': round(p5, 1), 'p50': round(p50, 1), 'p95': round(p95, 1), 'sat': round(sat, 3), 'colourful': round(colourful, 3), 'localContrast': round(local, 3)}

rows, tiles = [], []
for view, run, ref in PAIRS:
    for hour in HOURS:
        r = os.path.join(LC, RUNS[run], f'{view}-extreme-{hour}-real.png')
        if not os.path.exists(r):
            continue
        rp = GOLDEN if hour == '18.8' else ref
        ri, pi = load(r), load(os.path.join(HERE, 'refs', rp))
        mr, mp = metrics(ri), metrics(pi)
        rows.append({'view': view, 'hour': hour, 'ref': rp, 'render': mr, 'photo': mp})
        tiles.append((f'{view} {hour}h', ri, f'ref {rp}', pi))

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, f'metrics{TAG}.json'), 'w', newline='') as f:
    json.dump(rows, f, indent=1)
for r in rows:
    a, b = r['render'], r['photo']
    print(f"{r['view']:15s} {r['hour']:>4s}  render p5/50/95 {a['p5']:5.1f} {a['p50']:5.1f} {a['p95']:5.1f} sat {a['sat']:.2f} col {a['colourful']:.3f} lc {a['localContrast']:.3f}"
          f"  | photo {b['p5']:5.1f} {b['p50']:5.1f} {b['p95']:5.1f} sat {b['sat']:.2f} col {b['colourful']:.3f} lc {b['localContrast']:.3f}")

# Sheet: render and photo side by side, 480 px each, one row per pair at noon plus the golden-hour rows.
pick = [t for t in tiles if t[0].endswith(' 12h') or t[0].endswith(' 18.8h')]
w, h = 480, 270
sheet = Image.new('RGB', (2 * w, h * len(pick)), (0, 0, 0))
for i, (lr, ri, lp, pi) in enumerate(pick):
    for j, (lab, im) in enumerate(((lr, ri), (lp, pi))):
        t = im.copy()
        t.thumbnail((w, h))
        sheet.paste(t, (j * w, i * h))
        ImageDraw.Draw(sheet).text((j * w + 6, i * h + 6), lab, fill=(255, 40, 40))
sheet.save(os.path.join(OUT, f'audit-sheet{TAG}.png'))
print('sheet', os.path.join(OUT, f'audit-sheet{TAG}.png'))
