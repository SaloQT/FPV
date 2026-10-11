"""Scores exposure variants against the audit photos: per view and hour, render p5/p50 beside the photo's, and the mean |p50 error| per
variant over all pairs (07:00 and 12:00, the photo of each view as in metrics.py). The variants are measure.mjs runs at ultra under
.bench/lightcast/ (<view>-ultra-<hour>-real.png).
    python tools/audit/meterscore.py m-base m-tl45 m-tl60"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LC = os.path.join(HERE, '..', '..', '.bench', 'lightcast')
import ast
_src = open(os.path.join(HERE, 'metrics.py'), encoding='utf8').read()
PAIRS = ast.literal_eval(_src[_src.index('PAIRS = ') + len('PAIRS = '):_src.index(']', _src.index('PAIRS = ')) + 1])


def stats(path):
    a = np.asarray(Image.open(path).convert('RGB').resize((960, 540))).astype(np.float64) / 255
    l = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) * 255
    return np.percentile(l, [5, 50])


runs = sys.argv[1:]
err = {r: [] for r in runs}
print('view            hour  photo p5/p50   ' + '  '.join(f'{r:>14s}' for r in runs))
for view, _, ref in PAIRS:
    for hour in ('7', '12'):
        cells, ok = [], False
        ph = stats(os.path.join(HERE, 'refs', ref))
        for r in runs:
            f = os.path.join(LC, r, f'{view}-ultra-{hour}-real.png')
            if not os.path.exists(f):
                cells.append('-'.rjust(14)); continue
            ok = True
            s = stats(f)
            err[r].append(abs(s[1] - ph[1]))
            cells.append(f'{s[0]:5.1f}/{s[1]:6.1f}'.rjust(14))
        if ok:
            print(f'{view:15s} {hour:>4s}  {ph[0]:5.1f}/{ph[1]:6.1f}  ' + '  '.join(cells))
print('mean |p50 err| ' + '  '.join(f'{r} {np.mean(e):.1f} (median {np.median(e):.1f}, n {len(e)})' for r, e in err.items() if e))
