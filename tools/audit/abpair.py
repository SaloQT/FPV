"""Clean A/B of one text edit: snapshots src/ twice at the same moment (A as is, B with `old` replaced by `new` in one file), renders both
with measure.mjs and prints the pixel difference per view and hour. Other agents editing the live tree can't leak into the comparison.
python tools/audit/abpair.py <name> <file under src/> <old-text-file> <new-text-file> -- <measure.mjs args...>
  (old/new are files holding the exact text; use an empty new file to delete)"""
import os, shutil, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
name, rel, oldf, newf = sys.argv[1:5]
margs = sys.argv[sys.argv.index('--') + 1:]
old, new = open(oldf, encoding='utf8').read(), open(newf, encoding='utf8').read()
base = os.path.join(ROOT, '.bench', 'audit', 'abpair', name)
shutil.rmtree(base, ignore_errors=True)
for arm in ('a', 'b'):
    shutil.copytree(os.path.join(ROOT, 'src'), os.path.join(base, arm, 'src'))
p = os.path.join(base, 'b', 'src', rel)
s = open(p, encoding='utf8').read()
assert s.count(old) == 1, 'old text must occur exactly once'
open(p, 'w', encoding='utf8', newline='').write(s.replace(old, new))
for arm in ('a', 'b'):
    tag = f'ab-{name}-{arm}'
    with open(os.path.join(base, arm + '.log'), 'w') as log:
        subprocess.run(['node', 'tools/lightcast/measure.mjs', '--tag', tag, '--source', os.path.join(base, arm), *margs], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
da, db = (os.path.join(ROOT, '.bench', 'lightcast', f'ab-{name}-{arm}') for arm in ('a', 'b'))
for f in sorted(x for x in os.listdir(da) if x.endswith('-real.png')):
    a = np.asarray(Image.open(os.path.join(da, f))).astype(int)
    b = np.asarray(Image.open(os.path.join(db, f))).astype(int)
    d = np.abs(a - b)
    print(f'{f[:-9]:28s} max abs diff {d.max():3d}  differing pixels {(d.max(-1) > 0).mean():.5f}')
