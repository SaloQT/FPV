"""Side-by-side HEAD vs working tree from tools/audit/perf-ab.mjs: per case the median over rounds of fps, GPU ms, ready time and GPU ms
per pass. Reads .bench/audit/perf/{head,work}/r*-*.json.
    python tools/audit/perf-summary.py"""
import glob, json, os, statistics as st

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.bench', 'audit', 'perf')
PASSES = ['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post']
runs = {}
for arm in ('head', 'work'):
    for f in glob.glob(os.path.join(HERE, arm, 'r*-*.json')):
        case = os.path.basename(f).split('-', 1)[1][:-5]
        for r in json.load(open(f, encoding='utf-8')):
            runs.setdefault((case, arm), []).append(r)
med = lambda xs: st.median(xs) if xs else float('nan')
for case in sorted({c for c, _ in runs}):
    print(case)
    for arm in ('head', 'work'):
        rs = runs.get((case, arm), [])
        s = [r.get('stats', {}) for r in rs]
        passes = [med([x['passMs'][i] for x in s if x.get('passMs') and x['passMs'][i] is not None]) for i in range(len(PASSES))]
        errs = sum(len([c for c in r.get('console', []) if 'powerPref' not in c]) for r in rs)
        print(f"  {arm:4s} n{len(rs)} fps {med([x.get('fps') or 0 for x in s]):6.1f}  gpu {med([x.get('gpuMs') or 0 for x in s]):5.1f} ms  ready {med([r.get('readyS') or 0 for r in rs]):5.1f} s  "
              + ' '.join(f'{p} {v:4.1f}' for p, v in zip(PASSES, passes)) + f'  console {errs}')
