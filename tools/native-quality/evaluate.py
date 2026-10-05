"""Native RGB SSIM (11x11 Gaussian, sigma=1.5, population covariance).

No resizing, alignment, tone adjustment, alpha contribution or candidate-relative
reference. Hash-verified raw images and exact flight state are required. The
independent baseline-repeat comparisons calibrate pixel tolerances. A candidate
cannot set those tolerances. Uses NumPy, SciPy and Pillow from the local environment.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image

ORIGINAL = "dc1290668e223e77c1016f09cfdf5d0b24d7aa39ee05ea539908c87305bb3f8d"


def load_image(root, snap):
    name = snap['imageFile']
    if Path(name).name != name:
        raise ValueError('Unsafe image filename')
    raw = (root / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == snap['imageSha256'], 'Image hash mismatch'
    assert len(raw) == snap['width'] * snap['height'] * 4
    return np.frombuffer(raw, np.uint8).reshape(snap['height'], snap['width'], 4)


def ssim_rgb(a, b):
    # Gaussian support is exactly 11 pixels (radius=5); exclude the 5-pixel
    # boundary as in the original valid-window formulation. Full-resolution RGB.
    scores = []
    for c in range(3):
        total, count = 0., 0
        for start in range(5, a.shape[0]-5, 64):
            end = min(start+64, a.shape[0]-5)
            x = a[start-5:end+5, :, c].astype(np.float64)
            y = b[start-5:end+5, :, c].astype(np.float64)
            blur = lambda v: gaussian_filter(v, sigma=1.5, radius=5, mode='reflect')
            ux, uy = blur(x), blur(y)
            vx, vy, cov = blur(x*x)-ux*ux, blur(y*y)-uy*uy, blur(x*y)-ux*uy
            c1, c2 = (0.01*255)**2, (0.03*255)**2
            score = ((2*ux*uy+c1)*(2*cov+c2))/((ux*ux+uy*uy+c1)*(vx+vy+c2))
            valid = score[5:-5, 5:-5]
            total += float(valid.sum()); count += valid.size
        scores.append(total/count)
    return float(np.mean(scores)), scores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--baseline', required=True, type=Path)
    ap.add_argument('--candidate', required=True, type=Path)
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--review', type=Path)
    args = ap.parse_args()
    a, b = (json.loads(p.read_text()) for p in (args.baseline, args.candidate))
    artifact_a = a['artifact'] if isinstance(a['artifact'], str) else a['artifact']['id']
    assert artifact_a == ORIGINAL, 'Reference must be the ORIGINAL frozen baseline'
    assert a['status'] == b['status'] == 'valid', 'Invalid rendering result'
    for key in ('settings', 'workload', 'options', 'environment', 'adapter'):
        assert a[key] == b[key], f'{key} mismatch'
    assert a.get('states') == b.get('states'), 'Per-frame flight state divergence'
    assert a.get('raySelfTest') == b.get('raySelfTest'), 'GPU ray oracle divergence from original baseline'
    assert len(a['snapshots']) == len(b['snapshots']) >= 2
    rows, temporal = [], []
    previous_diff, previous_frame = None, None
    if args.review:
        args.review.mkdir(parents=True, exist_ok=True)
    for sa, sb in zip(a['snapshots'], b['snapshots']):
        for key in ('frameIndex', 'width', 'height', 'stateSha256'):
            assert sa[key] == sb[key], f'{key} mismatch'
        assert (sa['width'], sa['height']) == (3840, 2160), 'Native 4K required'
        x, y = load_image(args.baseline.parent, sa), load_image(args.candidate.parent, sb)
        exact = sa['imageSha256'] == sb['imageSha256']
        ss, channels = (1.0, [1.0]*3) if exact else ssim_rgb(x, y)
        squared, largest, changed = 0., 0, 0
        current_diff = np.empty(x.shape, np.int16)
        temporal_squared, temporal_max = 0., 0
        diff_image = np.empty((x.shape[0], x.shape[1], 3), np.uint8) if args.review else None
        for start in range(0, x.shape[0], 64):
            d = x[start:start+64].astype(np.int16)-y[start:start+64].astype(np.int16)
            current_diff[start:start+64] = d
            if previous_frame == sa['frameIndex'] - 1:
                delta = d[:, :, :3] - previous_diff[start:start+64, :, :3]
                temporal_squared += float(np.sum(delta.astype(np.float64)**2))
                temporal_max = max(temporal_max, int(np.abs(delta).max()))
            squared += float(np.sum(d.astype(np.float64)**2))
            largest = max(largest, int(np.abs(d).max()))
            changed += int(np.any(d[:, :, :3] != 0, axis=2).sum())
            if diff_image is not None:
                diff_image[start:start+64] = np.clip(np.abs(d[:, :, :3])*16, 0, 255).astype(np.uint8)
        row = dict(frame=sa['frameIndex'], ssim=ss, channelSsim=channels, exact=exact,
                   rmse=float(np.sqrt(squared/x.size)), max=largest, changedPixels=changed)
        rows.append(row)
        if previous_frame == sa['frameIndex'] - 1:
            temporal.append(dict(fromFrame=previous_frame, toFrame=sa['frameIndex'],
                                 rgbRmse=float(np.sqrt(temporal_squared/(x.shape[0]*x.shape[1]*3))), max=temporal_max))
        previous_diff, previous_frame = current_diff, sa['frameIndex']
        print(json.dumps(row), flush=True)
        if args.review:
            # Preserve full-resolution PNGs for inspection; scaled overview is
            # presentation only and never enters any quality metric.
            for tag, img in [('original', x), ('candidate', y)]:
                Image.fromarray(img).save(args.review / f'{sa["frameIndex"]:03d}-{tag}.png')
            Image.fromarray(diff_image).save(args.review / f'{sa["frameIndex"]:03d}-diff-x16.png')
    result = dict(baseline=str(args.baseline.resolve()), candidate=str(args.candidate.resolve()),
                  method='Native RGB SSIM; Gaussian 11x11 sigma 1.5; K1 .01 K2 .03; population covariance; 5px valid crop',
                  minimumRequiredSsim=0.98, passed=all(r['ssim'] >= .98 for r in rows),
                  minSsim=min(r['ssim'] for r in rows), maxRmse=max(r['rmse'] for r in rows),
                  maxByteDifference=max(r['max'] for r in rows), exactState=True,
                  checkedStateFrames=len(a.get('states', a['snapshots'])),
                  oracleUnchanged=True if a.get('raySelfTest') else None, originalOracle=a.get('raySelfTest'),
                  temporalResidual=temporal, samples=rows)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
