"""Backlit fringe leaves: foliage pixels within 4 px of sky (one or two leaf layers against the sky), their median luma, hue and saturation.
python tools/audit/fringe.py image x0,y0,x1,y1 [...]"""
import sys, colorsys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation

args = sys.argv[1:]
for path, box in zip(args[::2], args[1::2]):
    im = Image.open(path).convert('RGB')
    im = im.resize((960, round(im.height * 960 / im.width)))
    w, h = im.size
    x0, y0, x1, y1 = [float(v) for v in box.split(',')]
    a = np.asarray(im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))).astype(np.float64) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sky = ((b > g) & (b > r) & (l > 0.35)) | ((l > 0.7) & (np.abs(r - b) < 0.12) & (np.abs(g - b) < 0.12))
    leaf = ~sky & (g >= b)
    fringe = leaf & binary_dilation(sky, iterations=4)
    px = a[fringe]
    hsv = np.array([colorsys.rgb_to_hsv(*p) for p in px[:: max(1, len(px) // 4000)]])
    print(f'{path.split("/")[-1]:32s} fringe px {fringe.sum():6d}  luma {np.median(l[fringe]) * 255:5.0f}  hue {np.median(hsv[:, 0]) * 360:5.1f}  sat {np.median(hsv[:, 1]):.2f}')
