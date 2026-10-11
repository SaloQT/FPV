"""Marks the darkest 5% of displayed pixels in red over a dimmed copy of the frame. The run is a measure.mjs folder under .bench/lightcast/.
    python tools/audit/darkmask.py <run> <view-quality-hour> [out.png]"""
import os, sys
import numpy as np
from PIL import Image

LC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.bench', 'lightcast')
run, base = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(os.path.join(LC, run, base + '-real.png')).convert('RGB')).astype(np.float64)
luma = a @ np.array([0.2126, 0.7152, 0.0722])
dark = luma <= np.percentile(luma, 5)
o = a * 0.6
o[dark] = [255, 0, 0]
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(LC, run, base + '-dark.png')
Image.fromarray(o.astype(np.uint8)).save(out)
print(out)
