"""Lists Wikimedia Commons photo candidates for a search (title, licence, size, camera model), so a painting or diagram can be told apart
from a photograph before it becomes a reference. Add the chosen ones with fetchrefs.py.
    python tools/audit/findref.py "beech forest interior" [n]"""
import json, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'fpv-sim-photo-reference-audit/1.0'}
q = urllib.parse.urlencode({'action': 'query', 'generator': 'search', 'gsrsearch': f'filetype:bitmap {sys.argv[1]}', 'gsrnamespace': 6,
                            'gsrlimit': int(sys.argv[2]) if len(sys.argv) > 2 else 20, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata|metadata|size',
                            'iiurlwidth': 1280, 'format': 'json'})
with urllib.request.urlopen(urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + q, headers=UA), timeout=60) as r:
    pages = json.loads(r.read()).get('query', {}).get('pages', {})
for p in sorted(pages.values(), key=lambda p: p.get('index', 0)):
    ii = p['imageinfo'][0]
    meta = {m['name']: m['value'] for m in (ii.get('metadata') or []) if isinstance(m, dict) and 'name' in m}
    lic = ii.get('extmetadata', {}).get('LicenseShortName', {}).get('value', '')
    print(json.dumps({'title': p['title'], 'licence': lic, 'size': [ii.get('width'), ii.get('height')], 'camera': meta.get('Model'),
                      'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl')}))
