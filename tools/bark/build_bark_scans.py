"""Builds public/textures/bark/bark.bin, the photoscanned bark the tree shader maps on near trunks, from CC0 scans.

    python tools/bark/build_bark_scans.py [--cache .bench/bark-scans] [--size 1024]

Needs Pillow, numpy and etcpak (the BC7 encoder): pip install pillow numpy etcpak, ideally in a virtual environment.
The sources (2K JPG sets from ambientCG and Poly Haven and 1K sets from cgbookcase, all CC0) are downloaded once into the cache folder. Each scan becomes one layer of
two BC7 texture arrays with a full mip chain down to 4x4:
  colour   (bc7-rgba-unorm-srgb): albedo RGB, ambient occlusion in alpha
  surface  (bc7-rgba-unorm):      normal X and Y (OpenGL convention, 0.5 = flat), height (0 deepest, 1 highest), roughness
bark.bin is a small header ('BRK1', u32 JSON length, the JSON) followed by the blocks: for each texture, for each mip, every layer in order.
The JSON lists each layer's name, the real size in metres the scan covers (`metres`), its source and licence.
"""
import argparse
import io
import json
import os
import struct
import sys
import urllib.request
import zipfile

import etcpak
import numpy as np
from PIL import Image

UA = {'User-Agent': 'fpv-bark-builder/1.0'}

# Layer order is the shader's (tree_bark.wgsl SCAN_*). `metres` is how much bark one tile covers, judged from the plate and furrow sizes
# against the real bark of the species: Scots pine plates a hand wide, oak ridges two or three fingers apart, spruce scales a thumb wide.
LAYERS = [
    {'name': 'pine-plates', 'source': 'ambientcg', 'id': 'Bark004', 'metres': 0.9},
    {'name': 'pine-flakes', 'source': 'polyhaven', 'id': 'pine_bark', 'metres': 1.1},
    {'name': 'oak', 'source': 'ambientcg', 'id': 'Bark001', 'metres': 0.8},
    {'name': 'spruce', 'source': 'cgbookcase', 'id': 'Bark06', 'metres': 0.8},
    {'name': 'beech', 'source': 'ambientcg', 'id': 'Bark011', 'metres': 1.2},
    # Smooth pale bark with fine horizontal lines and pits: the relief under the birch's white paper (no birch scan is published under CC0).
    {'name': 'birch-paper', 'source': 'cgbookcase', 'id': 'Bark01', 'metres': 0.7},
]


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def ambientcg(asset, cache):
    path = os.path.join(cache, f'{asset}_2K-JPG.zip')
    if not os.path.exists(path):
        with open(path, 'wb') as f:
            f.write(fetch(f'https://ambientcg.com/get?file={asset}_2K-JPG.zip'))
    z = zipfile.ZipFile(path)
    names = z.namelist()

    def get(suffix):
        hit = [n for n in names if n.endswith(f'_{suffix}.jpg')]
        return Image.open(io.BytesIO(z.read(hit[0]))) if hit else None
    return {'colour': get('Color'), 'normal': get('NormalGL'), 'height': get('Displacement'), 'rough': get('Roughness'), 'ao': get('AmbientOcclusion'),
            'url': f'https://ambientcg.com/view?id={asset}'}


def polyhaven(asset, cache):
    files = json.loads(fetch(f'https://api.polyhaven.com/files/{asset}'))
    out = {'url': f'https://polyhaven.com/a/{asset}'}
    for key, label in [('colour', 'Diffuse'), ('normal', 'nor_gl'), ('height', 'Displacement'), ('rough', 'Rough'), ('ao', 'AO')]:
        entry = files.get(label, {}).get('2k', {})
        fmt = 'jpg' if 'jpg' in entry else 'png'
        if fmt not in entry:
            out[key] = None
            continue
        path = os.path.join(cache, f'{asset}_{label}_2k.{fmt}')
        if not os.path.exists(path):
            with open(path, 'wb') as f:
                f.write(fetch(entry[fmt]['url']))
        out[key] = Image.open(path)
    return out


def cgbookcase(asset, cache):
    """cgbookcase's 1K maps (CC0, https://www.cgbookcase.com/license). Their normal maps are DirectX style; the builder flips them to OpenGL."""
    out = {'url': f'https://www.cgbookcase.com/textures/{asset.lower().replace("bark", "bark-")}', 'directx': True}
    for key, label in [('colour', 'BaseColor'), ('normal', 'Normal'), ('height', 'Height'), ('rough', 'Roughness'), ('ao', 'AO')]:
        path = os.path.join(cache, f'{asset}_1K_{label}.png')
        if not os.path.exists(path):
            try:
                data = fetch(f'https://cgbookcase.b-cdn.net/textures/thumbnails/{asset}_1K/{asset}_1K_{label}.png')
            except Exception:
                out[key] = None
                continue
            with open(path, 'wb') as f:
                f.write(data)
        out[key] = Image.open(path)
    return out


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def square(img, size, mode):
    """The whole scan as a size x size float array in [0, 1]. A tall scan is squeezed rather than cropped: a scan tiles only as a whole, so a
    cropped square would show a seam at every repeat. The shader stretches it back (`along`, the metres one tile covers up the limb)."""
    img = img.convert(mode).resize((size, size), Image.LANCZOS)
    return np.asarray(img, dtype=np.float32) / 255.0


def gray(img, size):
    return square(img, size, 'L')


def stretch(h):
    lo, hi = np.percentile(h, 1), np.percentile(h, 99)
    return np.clip((h - lo) / max(hi - lo, 1e-4), 0, 1)


def cavity_from_height(h):
    """Ambient occlusion from the height alone, for scans that have no AO map: the deeper below its neighbourhood, the darker."""
    blur = h.copy()
    for r in (4, 16):
        acc = np.zeros_like(h)
        for dy in (-r, 0, r):
            for dx in (-r, 0, r):
                acc += np.roll(np.roll(h, dy, 0), dx, 1)
        blur = acc / 9
    return np.clip(1.0 - 1.6 * np.maximum(blur - h, 0), 0.25, 1.0)


def downsample(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def mips(colour_lin, ao, nrm, height, rough):
    """Mip chain of the two packed textures (uint8 RGBA arrays), down to 4x4: albedo is averaged in linear light, normals renormalised."""
    out_c, out_s = [], []
    while True:
        rgb = (linear_to_srgb(colour_lin) * 255 + 0.5).astype(np.uint8)
        a = (np.clip(ao, 0, 1) * 255 + 0.5).astype(np.uint8)
        out_c.append(np.dstack([rgb, a]))
        n = nrm / np.maximum(np.linalg.norm(nrm, axis=2, keepdims=True), 1e-6)
        s = np.dstack([(n[..., 0] * 0.5 + 0.5), (n[..., 1] * 0.5 + 0.5), height, rough])
        out_s.append((np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8))
        if colour_lin.shape[0] <= 4:
            break
        colour_lin, ao, height, rough = downsample(colour_lin), downsample(ao), downsample(height), downsample(rough)
        nrm = np.dstack([downsample(nrm[..., k]) for k in range(3)])
    return out_c, out_s


def bc7(rgba):
    return etcpak.compress_bc7(np.ascontiguousarray(rgba).tobytes(), rgba.shape[1], rgba.shape[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='.bench/bark-scans')
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--out', default='public/textures/bark')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    size = args.size
    packs = {'colour': [], 'surface': []}
    meta = []
    for layer in LAYERS:
        src = {'ambientcg': ambientcg, 'polyhaven': polyhaven, 'cgbookcase': cgbookcase}[layer['source']](layer['id'], args.cache)
        colour = srgb_to_linear(square(src['colour'], size, 'RGB'))
        nrm = square(src['normal'], size, 'RGB') * 2 - 1
        if src.get('directx'):
            nrm[..., 1] = -nrm[..., 1]
        height = stretch(gray(src['height'], size))
        rough = gray(src['rough'], size) if src['rough'] is not None else np.full((size, size), 0.9, np.float32)
        ao = gray(src['ao'], size) if src['ao'] is not None else cavity_from_height(height)
        c, s = mips(colour, ao, nrm, height, rough)
        packs['colour'].append(c)
        packs['surface'].append(s)
        # `metres` is the tile's width round the limb; a tall scan covers proportionally more bark up it.
        w, h = src['colour'].size
        meta.append({'name': layer['name'], 'metres': layer['metres'], 'along': round(layer['metres'] * h / w, 4), 'source': src['url'], 'licence': 'CC0 1.0'})
        print(layer['name'], 'mean albedo', np.round(colour.mean(axis=(0, 1)), 3), 'roughness', round(float(rough.mean()), 2), file=sys.stderr)
    levels = len(packs['colour'][0])
    blobs = []
    for tex in ('colour', 'surface'):
        for m in range(levels):
            for layer in packs[tex]:
                blobs.append(bc7(layer[m]))
    header = json.dumps({'size': size, 'mips': levels, 'layers': meta, 'textures': [
        {'name': 'colour', 'format': 'bc7-rgba-unorm-srgb'}, {'name': 'surface', 'format': 'bc7-rgba-unorm'}]}).encode()
    with open(os.path.join(args.out, 'bark.bin'), 'wb') as f:
        f.write(b'BRK1' + struct.pack('<I', len(header)) + header)
        for b in blobs:
            f.write(b)
    with open(os.path.join(args.out, 'LICENSE.md'), 'w', encoding='utf-8') as f:
        f.write('# Bark scans\n\nbark.bin is built by tools/bark/build_bark_scans.py from these photoscanned materials, all released under CC0 1.0 '
                '(public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/):\n\n')
        for m in meta:
            f.write(f"- {m['name']}: {m['source']}\n")
    print('wrote', os.path.join(args.out, 'bark.bin'), os.path.getsize(os.path.join(args.out, 'bark.bin')), 'bytes', file=sys.stderr)


if __name__ == '__main__':
    main()
