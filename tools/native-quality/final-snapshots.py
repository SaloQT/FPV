"""Check every retained final timing snapshot after all GPU runs have finished."""
import json
from pathlib import Path
import subprocess
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor

root = Path(__file__).resolve().parents[2]
evidence = root/'.bench/research-20261005'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--id', default='E05')
args = parser.parse_args()
prefix = args.id.lower()
assert prefix.startswith('e') and prefix[1:].isdigit()
comparison = json.loads((evidence/f'{prefix}-final.json').read_text())
assert comparison['status'] == 'valid' and comparison['verdict'] == 'improved'
assert comparison['completedPairs'] == 9 and comparison['correctness'] == 'passed'
def check_pair(pair):
    output = evidence/f'{prefix}-final-pair-{pair["index"]}-quality.json'
    subprocess.run([sys.executable, str(root/'tools/native-quality/evaluate.py'),
                    '--baseline', pair['baselineFile'], '--candidate', pair['candidateFile'], '--out', str(output)], check=True)
    return json.loads(output.read_text())

# CPU-only checks start only after all nine serialized GPU pairs have finished.
# Bound memory and process count; each child retains the identical SSIM method.
with ThreadPoolExecutor(max_workers=2) as pool:
    reports = list(pool.map(check_pair, comparison['pairs']))
result = dict(passed=all(r['passed'] for r in reports), pairs=9, imageComparisons=sum(len(r['samples']) for r in reports),
              minSsim=min(r['minSsim'] for r in reports), maxRmse=max(r['maxRmse'] for r in reports),
              maxByteDifference=max(r['maxByteDifference'] for r in reports), exactStates=all(r['exactState'] for r in reports),
              reports=[str(evidence/f'{prefix}-final-pair-{p["index"]}-quality.json') for p in comparison['pairs']])
(evidence/f'{prefix}-final-snapshots-quality.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result), flush=True)
