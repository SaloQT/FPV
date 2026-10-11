"""Share of aerial perspective in the darkest 5% of displayed pixels: a run's HDR minus the same frames rendered with the AP in-scatter
removed (measure.mjs --dump on both), over the run's HDR. Also p5/p50 of the displayed frame.
    python tools/audit/apshare.py <no-ap run> <run> [<run> ...]      (runs are .bench/lightcast/<tag> folders)"""
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


noap, runs = sys.argv[1], sys.argv[2:]
for f in sorted(x for x in os.listdir(os.path.join(LC, runs[0])) if x.endswith('-real.hdr.bin')):
    base = f[:-len('-real.hdr.bin')]
    cells = []
    for r in runs:
        real = hdr(os.path.join(LC, r, f))
        none = hdr(os.path.join(LC, noap, f))
        h, w = real.shape
        im = Image.open(os.path.join(LC, r, base + '-real.png')).convert('RGB').resize((w, h), Image.NEAREST)
        luma = (np.asarray(im).astype(np.float64) / 255.0) @ W * 255
        p5, p50 = np.percentile(luma, [5, 50])
        dark = luma <= p5
        share = (real[dark] - none[dark]).mean() / max(real[dark].mean(), 1e-9)
        cells.append(f'{r}: ap {share:5.2f} p5 {p5:5.1f} p50 {p50:5.1f}')
    print(f'{base:22s} ' + ' | '.join(cells))
