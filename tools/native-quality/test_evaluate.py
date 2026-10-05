import unittest
import numpy as np
from evaluate import ssim_rgb


class NativeSsimTests(unittest.TestCase):
    def test_constant_luminance_has_known_closed_form(self):
        a = np.full((141, 39, 4), 50, np.uint8)
        b = np.full_like(a, 60)
        expected = (2*50*60+(0.01*255)**2)/(50**2+60**2+(0.01*255)**2)
        self.assertAlmostEqual(ssim_rgb(a, b)[0], expected, places=12)

    def test_identical_texture_is_one(self):
        a = np.random.default_rng(17).integers(0, 256, (141, 39, 4), dtype=np.uint8)
        self.assertEqual(ssim_rgb(a, a)[0], 1.)

    def test_strip_boundary_pixel_is_included_and_comparison_is_symmetric(self):
        a = np.full((141, 39, 4), 50, np.uint8)
        b = a.copy()
        b[69, 20, 0] = 100
        forward, channels = ssim_rgb(a, b)
        self.assertLess(forward, 1.)
        self.assertEqual(channels[1:], [1., 1.])
        self.assertAlmostEqual(forward, ssim_rgb(b, a)[0], places=14)

    def test_alpha_is_excluded(self):
        a = np.full((141, 39, 4), 50, np.uint8)
        b = a.copy(); b[:, :, 3] = 0
        self.assertEqual(ssim_rgb(a, b)[0], 1.)


if __name__ == '__main__':
    unittest.main()
