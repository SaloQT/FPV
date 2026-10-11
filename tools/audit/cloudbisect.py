"""Cloud cost bisect at ultra: builds copies of src/ with one cloud_density.wgsl change undone each, then profiles them and the live tree
with modcost.mjs --detail (clouds ms), interleaved twice.
    cells:   the weather map back to three value-noise octaves (no convective cells, no log remap)
    lumps:   TOP_LUMPS 0 (no cauliflower tops)
    noclear: the night clearing removed
python tools/audit/cloudbisect.py   (results in .bench/audit/modcost/cb-*.json)"""
import json, os, shutil, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
M = os.path.join(ROOT, '.bench', 'audit', 'modcost')
REL = os.path.join('src', 'render', 'shaders', 'sky', 'cloud_density.wgsl')
EDITS = {
    'cells': [('  let raw = 0.45 * cumulusCells(xz) + 0.35 * vnoise2(xz / 1.6 + vec2f(17.3, 9.1)) + 0.2 * vnoise2(xz / 0.7 + vec2f(3.7, 41.9));\n  return saturate(1.156 + 0.583 * log(max(raw, 1e-4)));',
               '  return 0.45 * vnoise2(xz / 3.5) + 0.35 * vnoise2(xz / 1.6 + vec2f(17.3, 9.1)) + 0.2 * vnoise2(xz / 0.7 + vec2f(3.7, 41.9));')],
    'lumps': [('const TOP_LUMPS : f32 = 0.6;', 'const TOP_LUMPS : f32 = 0.0;')],
    'noclear': [('  let n = cumulusWeather(xz) - nightClearing(xz, day);', '  let n = cumulusWeather(xz);')],
}
env = dict(os.environ, FPV_TREE_CACHE_DIR='.cache/trees-work-agent')
for v, edits in EDITS.items():
    d = os.path.join(M, f'src-cb-{v}')
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(os.path.join(ROOT, 'src'), os.path.join(d, 'src'))
    p = os.path.join(d, REL)
    s = open(p, encoding='utf8').read()
    for a, b in edits:
        assert s.count(a) == 1, (v, a[:60])
        s = s.replace(a, b)
    open(p, 'w', encoding='utf8', newline='').write(s)
runs = [('live', '.')] + [(v, os.path.join(M, f'src-cb-{v}')) for v in EDITS]
for rnd in (1, 2):
    for tag, src in runs:
        t = f'cb-{tag}-{rnd}'
        with open(os.path.join(M, t + '.log'), 'w') as log:
            subprocess.run(['node', 'tools/audit/modcost.mjs', '--tag', t, '--source', src, '--detail', '1'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        r = json.load(open(os.path.join(M, t + '.json')))['gpu']
        print(f"{t:16s} full {r['full']:.2f}  pre {r['passMs'][0]:.2f}  clouds {(r.get('detailMs') or {}).get('clouds')}", flush=True)
