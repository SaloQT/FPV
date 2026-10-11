"""Hue and saturation of sunlit leaf pixels: within a box, foliage pixels (green-dominant, not sky), the brightest quarter of them by luma.
Prints median luma, HSV hue (deg), HSV saturation and the mean RGB of that set.  python tools/audit/leafcolour.py image x0,y0,x1,y1 [...]"""
import sys, colorsys
import numpy as np
from PIL import Image

args = sys.argv[1:]
for path, box in zip(args[::2], args[1::2]):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    x0, y0, x1, y1 = [float(v) for v in box.split(',')]
    a = np.asarray(im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))).astype(np.float64) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    foliage = (g >= r * 0.9) & (g >= b) & ~((b > g) & (l > 0.35))
    v = l[foliage]
    lit = foliage & (l >= np.percentile(v, 75))
    px = a[lit]
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[:: max(1, len(px) // 4000)]])
    m = px.mean(0)
    print(f'{path.split("/")[-1]:40s} lit luma {np.median(l[lit]) * 255:5.0f}  hue {np.median(hsv[:, 0]) * 360:5.1f}  sat {np.median(hsv[:, 1]):.2f}  rgb {np.round(m * 255).astype(int)}')
