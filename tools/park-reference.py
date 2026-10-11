"""Convert downloaded OSM map tiles into a measured, attributed park reference plan.

Example:
  python tools/park-reference.py --input .bench/park-reference/disneyland-*.osm \
    --park Disneyland --out .bench/park-reference/disneyland

The input is a local OpenStreetMap API export; this tool never contacts a network.
Missing features remain unmapped. Untagged path widths are explicitly estimates.
"""
import argparse
import glob
import html
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET


def tags(element):
    return {tag.attrib['k']: tag.attrib['v'] for tag in element.findall('tag')}


def stitch(chains):
    chains = [list(chain) for chain in chains if len(chain) >= 2]
    rings = []
    while chains:
        ring = chains.pop()
        while ring[-1] != ring[0]:
            found = False
            for i, other in enumerate(chains):
                if other[0] == ring[-1]:
                    ring.extend(other[1:])
                elif other[-1] == ring[-1]:
                    ring.extend(reversed(other[:-1]))
                elif other[-1] == ring[0]:
                    ring = other[:-1] + ring
                elif other[0] == ring[0]:
                    ring = list(reversed(other[1:])) + ring
                else:
                    continue
                chains.pop(i)
                found = True
                break
            if not found:
                raise ValueError('Incomplete multipolygon: download all boundary member ways')
        rings.append(ring)
    return rings


def classify(t):
    if t.get('building', 'no') != 'no' or t.get('building:part', 'no') != 'no':
        return 'building'
    if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or 'water' in t:
        return 'water'
    if t.get('landuse') in ('forest', 'grass', 'flowerbed') or t.get('natural') in ('wood', 'scrub', 'tree_row') or t.get('leisure') == 'garden':
        return 'landscape'
    if t.get('area:highway') or t.get('highway') in ('footway', 'pedestrian', 'path', 'steps', 'service', 'living_street'):
        return 'path'
    # Named themed lands describe a district, not a constructed ride footprint.
    if t.get('attraction') in ('theme_area', 'themed_area', 'themed_land', 'land'):
        return None
    if 'attraction' in t or 'roller_coaster' in t:
        return 'attraction'
    return None


def is_frontage(t, category):
    """Street enclosure requires a structure or explicitly woody vegetation, not water or a flat lawn."""
    return category == 'building' or (category == 'landscape' and (t.get('landuse') == 'forest' or t.get('natural') in ('wood', 'scrub', 'tree_row')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', nargs='+', required=True)
    parser.add_argument('--park', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    elements = {}
    files = sorted({p for pattern in args.input for p in glob.glob(pattern)})
    if not files:
        raise ValueError('No OSM input files matched')
    for filename in files:
        for e in ET.parse(filename).getroot():
            if 'id' in e.attrib:
                elements[e.tag, e.attrib['id']] = e
    nodes = {eid: (float(e.attrib['lon']), float(e.attrib['lat'])) for (kind, eid), e in elements.items() if kind == 'node'}
    ways = {eid: [n.attrib['ref'] for n in e.findall('nd')] for (kind, eid), e in elements.items() if kind == 'way'}
    park = next((e for e in elements.values() if tags(e).get('tourism') == 'theme_park' and tags(e).get('name') == args.park and e.tag in ('way', 'relation')), None)
    if park is None:
        raise ValueError(f'No complete theme park boundary named {args.park!r}')

    def relation_rings(element, role):
        return stitch([ways[m.attrib['ref']] for m in element.findall('member') if m.attrib['type'] == 'way' and (m.attrib.get('role') or 'outer') == role])

    boundary_ids = relation_rings(park, 'outer') if park.tag == 'relation' else [ways[park.attrib['id']]]
    all_boundary = [nodes[n] for ring in boundary_ids for n in ring]
    lon0 = sum(p[0] for p in all_boundary) / len(all_boundary)
    lat0 = sum(p[1] for p in all_boundary) / len(all_boundary)
    # Local equirectangular tangent plane, metre units, x east / z south (SVG north-up).
    mx = 6371008.8 * math.pi / 180 * math.cos(math.radians(lat0))
    mz = 6371008.8 * math.pi / 180

    def project(ids):
        return [[round((nodes[n][0] - lon0) * mx, 3), round((lat0 - nodes[n][1]) * mz, 3)] for n in ids]

    boundary = [project(ring) for ring in boundary_ids]
    boundary_holes = [project(ring) for ring in relation_rings(park, 'inner')] if park.tag == 'relation' else []
    features = []
    used_members = set()
    for (kind, eid), e in elements.items():
        if kind != 'relation' or e is park or tags(e).get('type') != 'multipolygon':
            continue
        t = tags(e)
        category = classify(t)
        if not category:
            continue
        try:
            outer, inner = relation_rings(e, 'outer'), relation_rings(e, 'inner')
        except (KeyError, ValueError):
            # Partial features at tile margins are not silently invented.
            continue
        used_members.update(m.attrib['ref'] for m in e.findall('member') if m.attrib['type'] == 'way')
        features.append({'id': f'relation/{eid}', 'category': category, 'frontage': is_frontage(t, category), 'name': t.get('name', ''), 'polygons': [project(r) for r in outer], 'holes': [project(r) for r in inner]})
    width_defaults = {'pedestrian': 8, 'footway': 3, 'path': 2.5, 'steps': 2, 'service': 5, 'living_street': 6}
    for (kind, eid), e in elements.items():
        if kind != 'way' or eid in used_members or e is park:
            continue
        t = tags(e)
        category = classify(t)
        if not category or len(ways[eid]) < 2:
            continue
        pts = project(ways[eid])
        if category == 'attraction' and t.get('attraction') in ('roller_coaster', 'miniature_train', 'train') or 'roller_coaster' in t:
            closed_area = t.get('area') == 'yes'
        else:
            closed_area = ways[eid][0] == ways[eid][-1] and t.get('area') != 'no' and (category != 'path' or t.get('area') == 'yes' or 'area:highway' in t)
        feature = {'id': f'way/{eid}', 'category': category, 'frontage': is_frontage(t, category), 'name': t.get('name', ''), 'highway': t.get('highway', ''), 'access': t.get('access', ''), 'queue': t.get('queue', ''), 'indoor': t.get('indoor', '')}
        if closed_area:
            feature.update(polygons=[pts], holes=[])
        else:
            try:
                width = float(t.get('width', t.get('est_width', '')).replace(' m', ''))
                estimated = 'width' not in t
            except ValueError:
                width = width_defaults.get(t.get('highway'), 4)
                estimated = True
            feature.update(points=pts, width=max(0.5, min(40, width)), widthEstimated=estimated)
        features.append(feature)
    xs = [p[0] for ring in boundary for p in ring]
    zs = [p[1] for ring in boundary for p in ring]
    x0, z0, x1, z1 = min(xs), min(zs), max(xs), max(zs)
    w, h = x1 - x0, z1 - z0
    source = f"https://www.openstreetmap.org/{park.tag}/{park.attrib['id']}"
    result = {'name': args.park, 'source': source, 'attribution': '© OpenStreetMap contributors, ODbL 1.0', 'downloaded': '2026-10-08',
              'projection': {'originLon': lon0, 'originLat': lat0, 'x': 'east metres', 'z': 'south metres'}, 'boundary': boundary, 'boundaryHoles': boundary_holes, 'features': features,
              'limitations': 'Mapped coverage only. OSM detail can be incomplete; missing features are not confirmed empty land. Untagged line widths are estimates, listed per feature. Illustrative guest maps are a separate qualitative reference.'}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix('.json').write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    colors = {'building': '#b88358', 'attraction': '#518aae', 'path': '#e0d2b5', 'water': '#69b5c8', 'landscape': '#7caa78'}

    def path(rings):
        return ' '.join('M' + ' L'.join(f'{x},{z}' for x, z in ring) + ' Z' for ring in rings)

    stroke = max(w, h) / 1800
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="{int(1600*(h+140)/(w+50))}" viewBox="{x0-25} {z0-80} {w+50} {h+140}">',
           '<rect x="-100000" y="-100000" width="200000" height="200000" fill="#f8f6ef"/>',
           f'<text x="{x0}" y="{z0-48}" font-family="sans-serif" font-size="24" fill="#233642">{html.escape(args.park)} — measured reference plan</text>',
           f'<text x="{x0}" y="{z0-25}" font-family="sans-serif" font-size="11" fill="#58646b">North ↑ • metre projection • mapped OSM footprints, not an illustrated guest map</text>',
           f'<defs><clipPath id="park"><path d="{path(boundary+boundary_holes)}" clip-rule="evenodd"/></clipPath></defs>',
           f'<path d="{path(boundary+boundary_holes)}" fill="#e8e9df" fill-rule="evenodd" stroke="#293a44" stroke-width="{stroke*2}"/>', '<g clip-path="url(#park)">']
    for category in ['landscape', 'water', 'path', 'attraction', 'building']:
        for f in features:
            if f['category'] != category:
                continue
            title = html.escape(f['name'] or f['id'])
            if 'polygons' in f:
                svg.append(f'<path d="{path(f["polygons"]+f["holes"])}" fill="{colors[category]}" fill-rule="evenodd" stroke="#ffffff" stroke-width="{stroke*.35}"><title>{title}</title></path>')
            else:
                points = ' '.join(f'{x},{z}' for x, z in f['points'])
                svg.append(f'<polyline points="{points}" fill="none" stroke="{colors[category]}" stroke-width="{f["width"]}" stroke-linecap="round" stroke-linejoin="round"><title>{title}</title></polyline>')
    svg.append('</g>')
    for i, (category, color) in enumerate(colors.items()):
        x = x0 + i * w / 5
        svg.append(f'<rect x="{x}" y="{z1+13}" width="11" height="11" fill="{color}"/><text x="{x+16}" y="{z1+23}" font-family="sans-serif" font-size="11" fill="#233642">{category}</text>')
    svg += [f'<text x="{x0}" y="{z1+43}" font-family="sans-serif" font-size="9" fill="#58646b">© OpenStreetMap contributors · ODbL 1.0 · 2026-10-08 · Missing map detail is not evidence of empty space.</text>',
            f'<path d="M{x1-100},{z0+5} h100 m0,-4 v8 m-100,-8 v8" fill="none" stroke="#233642" stroke-width="2"/><text x="{x1-50}" y="{z0+21}" text-anchor="middle" font-family="sans-serif" font-size="10">100 m</text>', '</svg>']
    out.with_suffix('.svg').write_text('\n'.join(svg), encoding='utf-8')
    print(json.dumps({'name': args.park, 'features': len(features), 'boundaryRings': len(boundary), 'boundsMetres': [round(w), round(h)], 'source': source, 'out': str(out)}))


if __name__ == '__main__':
    main()
