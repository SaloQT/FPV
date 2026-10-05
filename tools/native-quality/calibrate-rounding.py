"""Independent rounding control from ORIGINAL images, never candidate deltas.

The user accepted close visual output after the initial repeatability-only gate.
Round native RGB channels to their nearest even byte (ties up, clip at 255),
retain alpha, and require every control image to meet SSIM >= .98. Use the
largest resulting RMSE as the paired runner's reviewed-difference allowance;
the independently measured repeatability maximum-byte bound stays unchanged.
This control does not replace the SSIM gate or visual inspection of candidates.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from evaluate import load_image, ssim_rgb, ORIGINAL

ap = argparse.ArgumentParser()
ap.add_argument('--baseline', required=True, type=Path)
ap.add_argument('--repeatability', required=True, type=Path)
ap.add_argument('--out', required=True, type=Path)
args = ap.parse_args()
baseline = json.loads(args.baseline.read_text())
assert baseline['artifact'] == ORIGINAL and baseline['status'] == 'valid'
repeatability = json.loads(args.repeatability.read_text())
rows = []
for snap in baseline['snapshots']:
    x = load_image(args.baseline.parent, snap)
    y = x.copy()
    squared = 0.
    for start in range(0, x.shape[0], 64):
        source = x[start:start+64, :, :3].astype(np.uint16)
        y[start:start+64, :, :3] = np.minimum(((source+1)//2)*2, 255).astype(np.uint8)
        delta = source.astype(np.int16)-y[start:start+64, :, :3].astype(np.int16)
        squared += float(np.sum(delta.astype(np.float64)**2))
    ss, channels = ssim_rgb(x, y)
    row = dict(frame=snap['frameIndex'], ssim=ss, channelSsim=channels, rmse=float(np.sqrt(squared/x.size)), max=1)
    rows.append(row)
    print(json.dumps(row), flush=True)
assert min(r['ssim'] for r in rows) >= .98, 'Rounding control failed SSIM; do not use this allowance'
result = dict(method=__doc__, baseline=str(args.baseline.resolve()), candidateDataUsed=False,
              imageRmse=max(r['rmse'] for r in rows), imageMax=repeatability['imageMax'], ssimMinimum=.98,
              controlMinSsim=min(r['ssim'] for r in rows), samples=rows)
args.out.write_text(json.dumps(result, indent=2)+'\n')
