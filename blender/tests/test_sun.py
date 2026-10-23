import math
import unittest
from datetime import datetime, timezone

from pipeline import sun

PORTO = (41.117327, -8.653914)


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc).timestamp()


class SolarPositionTests(unittest.TestCase):
    def test_nrel_reference_case(self):
        az, el = sun.solar_position(_utc(2003, 10, 17, 19, 30, 30), 39.742476, -105.1786)
        self.assertLess(abs(90 - el - 50.11162), 0.05)
        self.assertLess(abs(az - 194.34024), 0.05)

    def test_porto_solstice_noons(self):
        for day, expected in (("2026-06-21", 72.33), ("2026-12-21", 25.48)):
            base = sun.lisbon_to_utc_seconds(day + "T00:00")
            best = max(sun.solar_position(base + 60 * m, *PORTO)[1] for m in range(1440))
            self.assertAlmostEqual(best, expected, delta=0.05)

    def test_lisbon_summer_time(self):
        self.assertEqual(sun.lisbon_to_utc_seconds("2026-03-29T12:00"), _utc(2026, 3, 29, 11))
        self.assertEqual(sun.lisbon_to_utc_seconds("2026-10-25T12:00"), _utc(2026, 10, 25, 12))

    def test_blender_direction(self):
        x, y, z = sun.blender_direction(142.1, 0.0, 142.1)
        self.assertAlmostEqual(x, 0.0)
        self.assertAlmostEqual(y, 1.0)
        self.assertAlmostEqual(z, 0.0)
        self.assertAlmostEqual(sun.blender_direction(232.1, 0.0, 142.1)[0], 1.0)


class ClimateTests(unittest.TestCase):
    CLIMATE = {"months": [{"month": m + 1, "sunshineHours": 0, "cloudCover": 0, "hours": [
        {"utcHour": h + 0.5, "gb": 100.0 if h == 12 else 0.0, "gd": float(m + 1), "gcs": 0.0} for h in range(24)]}
        for m in range(12)]}

    def test_typical_irradiance(self):
        beam, diffuse = sun.typical_irradiance(self.CLIMATE, _utc(2026, 1, 16, 12, 30))
        self.assertAlmostEqual(beam, 100.0)
        self.assertAlmostEqual(diffuse, 1.0, delta=0.01)
        beam, diffuse = sun.typical_irradiance(self.CLIMATE, _utc(2026, 2, 1))
        self.assertEqual(beam, 0.0)
        self.assertAlmostEqual(diffuse, 1.5)

    def test_sun_strength(self):
        self.assertEqual(sun.sun_strength(500, -1), 0)
        self.assertAlmostEqual(sun.sun_strength(500, 30), 1000)
        self.assertAlmostEqual(sun.sun_strength(10, 1), 10 / math.sin(math.radians(3)))


if __name__ == "__main__":
    unittest.main()
