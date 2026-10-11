"""Splits the darkest 5% of each displayed frame into its lighting terms, from measure.mjs --dump runs (terms real,rsun,rgi,rspec,rap).
For the pixels at or under the displayed luma p5, prints the mean HDR luminance of each term as a share of the real HDR, and the
HDR stops between p5 and p50. The run is a .bench/lightcast/<tag> folder made with
    node tools/lightcast/measure.mjs --tag a-terms --terms real,rsun,rgi,rspec,rap --dump ...
    python tools/audit/termsplit.py a-terms"""
import os, sys
import numpy as np
from PIL import Image

LC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.bench', 'lightcast')
W = np.array([0.2126, 0.7152, 0.0722])

def hdr(path):
    raw = open(path, 'rb').read()
    w, h, bpr = np.frombuffer(raw[:12], np.uint32)
    rows = np.frombuffer(raw[12:], np.uint8).reshape(h, bpr)[:, :w * 8]
    return np.frombuffer(rows.tobytes(), np.float16).reshape(h, w, 4)[..., :3].astype(np.float64) @ W

run = sys.argv[1]
d = os.path.join(LC, run)
for f in sorted(x for x in os.listdir(d) if x.endswith('-real.hdr.bin')):
    base = f[:-len('-real.hdr.bin')]
    real = hdr(os.path.join(d, f))
    h, w = real.shape
    im = Image.open(os.path.join(d, base + '-real.png')).convert('RGB').resize((w, h), Image.NEAREST)
    luma = (np.asarray(im).astype(np.float64) / 255.0) @ W * 255
    p5, p50 = np.percentile(luma, [5, 50])
    dark = luma <= p5
    mid = np.abs(luma - p50) < 3
    parts = {t: hdr(os.path.join(d, f'{base}-{t}.hdr.bin')) for t in ('rsun', 'rgi', 'rspec', 'rap') if os.path.exists(os.path.join(d, f'{base}-{t}.hdr.bin'))}
    r = real[dark].mean()
    share = ' '.join(f'{t[1:]} {parts[t][dark].mean() / r:5.2f}' for t in parts)
    stops = np.log2(np.median(real[mid]) / max(np.median(real[dark]), 1e-9)) if mid.any() else float('nan')
    print(f'{base:26s} p5 {p5:5.1f} p50 {p50:5.1f} | dark-pixel shares of real: {share} | p50/p5 {stops:4.1f} stops')
