"""Sky fraction inside a crown's silhouette, the same way for photographs and renders.
Within a box around the crown, a pixel is sky when it is bright and bluish or near-white (clear or overcast sky), else crown. For each row the
silhouette spans from its leftmost to its rightmost crown pixel; the sky fraction is the sky pixels inside those spans over the span pixels, over
the rows between 10% and 90% of the crown's height (the tip and the trunk below are left out).
Used for the crown-density checks in TASKS.md, against the photos in tools/audit/refs/ (spruce-tree, pine-crown, oak-crown).
    python tools/audit/skyfrac.py image.png x0,y0,x1,y1 [mask.png]   (box as fractions of the image; mask: crown green, sky inside red)"""
import sys
import numpy as np
from PIL import Image

def sky_fraction(path, box, mask_out=None):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    x0, y0, x1, y1 = [float(v) for v in box.split(',')]
    a = np.asarray(im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))).astype(np.float64) / 255
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sky = ((b > g) & (b > r) & (lum > 0.35)) | ((lum > 0.7) & (np.abs(r - b) < 0.12) & (np.abs(g - b) < 0.12))
    crown = ~sky
    rows = np.where(crown.any(axis=1))[0]
    if len(rows) == 0:
        return float('nan')
    top, bot = rows[0], rows[-1]
    inside = skyin = 0
    span = np.zeros_like(sky)
    for y in range(top + int(0.1 * (bot - top)), bot - int(0.1 * (bot - top)) + 1):
        xs = np.where(crown[y])[0]
        if len(xs) < 2:
            continue
        lo, hi = int(np.percentile(xs, 3)), int(np.percentile(xs, 97))
        inside += hi - lo + 1
        skyin += sky[y, lo:hi + 1].sum()
        span[y, lo:hi + 1] = True
    if mask_out:
        vis = np.zeros(a.shape, np.uint8)
        vis[crown] = (40, 120, 40)
        vis[span & sky] = (255, 60, 60)
        vis[~span & sky] = (120, 160, 255)
        Image.fromarray(vis).save(mask_out)
    return skyin / max(inside, 1)

if __name__ == '__main__':
    print(f'{sky_fraction(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None):.3f}')
