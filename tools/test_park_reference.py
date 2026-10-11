"""Focused regression checks for OSM classification and multipolygon topology."""
import importlib.util
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('park_reference', Path(__file__).with_name('park-reference.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


class ReferenceGeometryTests(unittest.TestCase):
    def test_mapped_land_is_not_automatically_street_enclosure(self):
        examples = [({'natural': 'water'}, 'water', False), ({'landuse': 'grass'}, 'landscape', False),
                    ({'landuse': 'flowerbed'}, 'landscape', False), ({'leisure': 'garden'}, 'landscape', False),
                    ({'natural': 'wood'}, 'landscape', True), ({'landuse': 'forest'}, 'landscape', True),
                    ({'natural': 'scrub'}, 'landscape', True), ({'building': 'yes'}, 'building', True)]
        for tags, category, frontage in examples:
            with self.subTest(tags=tags):
                self.assertEqual(reference.classify(tags), category)
                self.assertEqual(reference.is_frontage(tags, category), frontage)
        self.assertIsNone(reference.classify({'building': 'no'}))
        self.assertIsNone(reference.classify({'attraction': 'theme_area'}))

    def test_stitch_preserves_disjoint_rings_and_reversed_members(self):
        rings = reference.stitch([['a', 'b'], ['c', 'b'], ['c', 'd'], ['a', 'd'], ['x', 'y', 'z', 'x']])
        self.assertEqual(len(rings), 2)
        self.assertEqual({frozenset(ring) for ring in rings}, {frozenset('abcd'), frozenset('xyz')})
        self.assertTrue(all(ring[0] == ring[-1] for ring in rings))
        with self.assertRaisesRegex(ValueError, 'Incomplete multipolygon'):
            reference.stitch([['a', 'b'], ['b', 'c']])

    def test_converter_preserves_park_boundary_holes_and_empty_outer_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            coordinates = [(0, 0), (0.01, 0), (0.01, 0.01), (0, 0.01), (0.004, 0.004), (0.006, 0.004), (0.006, 0.006), (0.004, 0.006)]
            nodes = ''.join(f'<node id="{i+1}" lon="{lon}" lat="{lat}"/>' for i, (lon, lat) in enumerate(coordinates))
            way = lambda identity, ids: f'<way id="{identity}">' + ''.join(f'<nd ref="{i}"/>' for i in ids) + '</way>'
            xml = '<osm>' + nodes + way(9, [1, 2, 3, 4, 1]) + way(19, [5, 6, 7, 8, 5]) + '<relation id="20"><member type="way" ref="9" role=""/><member type="way" ref="19" role="inner"/><tag k="type" v="multipolygon"/><tag k="tourism" v="theme_park"/><tag k="name" v="Fixture"/></relation></osm>'
            (root / 'fixture.osm').write_text(xml, encoding='utf-8')
            with patch('sys.argv', ['park-reference.py', '--input', str(root / 'fixture.osm'), '--park', 'Fixture', '--out', str(root / 'plan')]), contextlib.redirect_stdout(io.StringIO()):
                reference.main()
            result = json.loads((root / 'plan.json').read_text(encoding='utf-8'))
            self.assertEqual(len(result['boundary']), 1)
            self.assertEqual(len(result['boundaryHoles']), 1)
            self.assertIn('clip-rule="evenodd"', (root / 'plan.svg').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
