"""Luma p5/p50/p95, saturation and local contrast of every PNG in the given lightcast run folders, side by side per file name.
The folders are measure.mjs runs under .bench/lightcast/.
    python tools/audit/pstats.py au au-noap au-toe"""
import os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

LC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.bench', 'lightcast')

def stats(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64) / 255.0
    luma = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    p5, p50, p95 = np.percentile(luma * 255, [5, 50, 95])
    mx, mn = a.max(-1), a.min(-1)
    sat = np.where(mx > 0.02, (mx - mn) / np.maximum(mx, 1e-6), 0).mean()
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    ll = np.log(np.maximum(0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2], 1e-4))
    m = uniform_filter(ll, 9)
    lc = np.sqrt(np.maximum(uniform_filter(ll * ll, 9) - m * m, 0)).mean()
    return f'{p5:5.1f} {p50:5.1f} {p95:5.1f} s{sat:.2f} lc{lc:.2f}'

runs = sys.argv[1:]
names = sorted(f for f in os.listdir(os.path.join(LC, runs[0])) if f.endswith('.png'))
print('file'.ljust(36) + ''.join(r.ljust(34) for r in runs))
for n in names:
    cells = []
    for r in runs:
        p = os.path.join(LC, r, n)
        cells.append((stats(p) if os.path.exists(p) else '-').ljust(34))
    print(n.replace('-real.png', '').ljust(36) + ''.join(cells))
