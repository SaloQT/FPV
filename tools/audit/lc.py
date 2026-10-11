"""Local contrast as tools/audit/metrics.py measures it (std of log luminance in 9x9 windows at 960 px wide), plus luma p5/p50, for renders.
python tools/audit/lc.py a.png [b.png ...]"""
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

for path in sys.argv[1:]:
    im = Image.open(path).convert('RGB')
    im = im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float64) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    luma = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    ll = np.log(np.maximum(0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2], 1e-4))
    m = uniform_filter(ll, 9)
    local = np.sqrt(np.maximum(uniform_filter(ll * ll, 9) - m * m, 0)).mean()
    p5, p50 = np.percentile(luma * 255, [5, 50])
    print(f'{path.split("/")[-1].split(chr(92))[-1]:45s} lc {local:.3f}  p5 {p5:5.1f}  p50 {p50:5.1f}')
