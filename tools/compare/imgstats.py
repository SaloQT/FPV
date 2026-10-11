"""Tone and colour statistics of images: luma percentiles (sRGB codes), the shadow share, and the mean HSV saturation of sky-like and
green-like pixels. python tools/compare/imgstats.py a.png b.jpg ..."""
import sys
import numpy as np
from PIL import Image

print(f"{'image':42s} {'p5':>5s} {'p50':>5s} {'p95':>5s} {'dark%':>6s} {'satSky':>7s} {'satGreen':>8s} {'skyRGB':>16s}")
for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert('RGB').resize((640, 360))).astype(float) / 255
    y = a @ np.array([0.2126, 0.7152, 0.0722])
    mx, mn = a.max(2), a.min(2)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    sky = (a[..., 2] > a[..., 0] + 0.05) & (a[..., 2] >= a[..., 1]) & (y > 0.35)
    green = (a[..., 1] > a[..., 0]) & (a[..., 1] > a[..., 2]) & (y > 0.05)
    q = np.percentile(y * 255, [5, 50, 95])
    sr = a[sky].mean(0) * 255 if sky.any() else np.zeros(3)
    print(f"{p[-42:]:42s} {q[0]:5.0f} {q[1]:5.0f} {q[2]:5.0f} {100 * (y < 0.1).mean():6.1f} {sat[sky].mean() if sky.any() else 0:7.2f} {sat[green].mean() if green.any() else 0:8.2f} {str(sr.round().astype(int)):>16s}")
