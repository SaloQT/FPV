#!/usr/bin/env python3
"""Convert the HYG v4.1 catalog CSV into public/data/stars.bin.

Record layout (little-endian float32 x4): ra_rad, dec_rad, apparent_mag, bv_color_index.
Header: uint32 magic 'STRS', uint32 count.
Usage: build_stars.py hygdata_v41.csv public/data/stars.bin [max_mag]
"""
import csv, struct, sys

src, dst = sys.argv[1], sys.argv[2]
max_mag = float(sys.argv[3]) if len(sys.argv) > 3 else 8.0
rows = []
with open(src, newline='') as f:
    for r in csv.DictReader(f):
        if r['proper'] == 'Sol':
            continue
        try:
            mag = float(r['mag']); ra = float(r['rarad']); dec = float(r['decrad'])
        except ValueError:
            continue
        if mag > max_mag:
            continue
        ci = r['ci']
        try:
            bv = float(ci) if ci != '' else 0.65
        except ValueError:
            bv = 0.65
        rows.append((mag, ra, dec, bv))
rows.sort()
with open(dst, 'wb') as out:
    out.write(struct.pack('<4sI', b'STRS', len(rows)))
    for mag, ra, dec, bv in rows:
        out.write(struct.pack('<4f', ra, dec, mag, bv))
print(f'{len(rows)} stars (mag <= {max_mag}) -> {dst}')
