"""Downloads reference photos from Wikimedia Commons for each audit scene, with their licence, author and source page, into
tools/audit/refs/<scene>/<n>.jpg and tools/audit/refs/<scene>/sources.json. Only CC and public-domain files are kept.

    python tools/audit/fetchrefs.py                       every scene below
    python tools/audit/fetchrefs.py "pine-crown=scots pine crown" ...   only the scenes given, as scene=search

A scene's folder is overwritten, so the photo numbers metrics.py pairs with change: refetch a scene only to replace it. Before a new photo is
committed, check its licence allows redistribution (CC0, CC BY, CC BY-SA or public domain) and keep its sources.json entry."""
import json, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {'User-Agent': 'fpv-sim-photo-reference-audit/1.0'}
SCENES = {
    'meadow-lone-tree': 'solitary tree meadow',
    'forest-edge': 'forest edge meadow',
    'forest-interior': 'beech forest summer',
    'conifers': 'spruce forest meadow',
    'rocks-cliff': 'rock outcrop meadow',
    'aerial': 'aerial forest meadow',
    'oak-crown': 'oak tree summer',
    'race-gate': 'drone racing gate',
    'track-aerial': 'forest track aerial',
    'golden-hour-meadow': 'meadow evening sun',
}
if len(sys.argv) > 1:
    SCENES = dict(a.split('=', 1) for a in sys.argv[1:])

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()

for scene, query in SCENES.items():
    out = os.path.join(HERE, 'refs', scene)
    os.makedirs(out, exist_ok=True)
    q = urllib.parse.urlencode({'action': 'query', 'generator': 'search', 'gsrsearch': f'filetype:bitmap {query}', 'gsrnamespace': 6, 'gsrlimit': 12,
                                'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 1280, 'format': 'json'})
    pages = json.loads(get('https://commons.wikimedia.org/w/api.php?' + q)).get('query', {}).get('pages', {})
    sources = []
    for p in sorted(pages.values(), key=lambda p: p.get('index', 0)):
        ii = p['imageinfo'][0]
        m = ii.get('extmetadata', {})
        lic = m.get('LicenseShortName', {}).get('value', '')
        if not ii.get('thumburl') or not any(k in lic for k in ('CC', 'Public domain', 'PD')):
            continue
        name = f'{len(sources)}.jpg'
        try:
            with open(os.path.join(out, name), 'wb') as f:
                f.write(get(ii['thumburl']))
        except Exception as e:
            print('skip', p['title'], e)
            continue
        sources.append({'file': name, 'title': p['title'], 'licence': lic, 'page': ii.get('descriptionurl'), 'artist': m.get('Artist', {}).get('value', '')[:200]})
        time.sleep(0.5)
    with open(os.path.join(out, 'sources.json'), 'w', encoding='utf-8', newline='') as f:
        json.dump(sources, f, indent=1)
    print(scene, len(sources))
