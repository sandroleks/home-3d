import unittest

from pipeline.openings import Opening
from pipeline.placement import choose_switch_spot

# Wall along z at x = 3.1 (0.2 thick); opening centre (3.1, -1.4), 0.8 wide.
OP = Opening(1, False, ("Alpha", "Beta"), (3.1, -1.4), (0.0, 1.0), (-1.0, 0.0), 0.8, 0.2)


def locate(x, z):
    if x < 3.0:
        return "alpha"
    if x > 3.2:
        return "beta"
    return None


def blocked(x, z):
    in_wall = 3.0 <= x <= 3.2 and not (-1.8 <= z <= -1.0)
    shelf = 3.4 <= x <= 3.9 and -1.3 <= z <= -0.5
    return in_wall or shelf


class SwitchSpotTests(unittest.TestCase):
    def test_alpha_first_side(self):
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked)
        self.assertAlmostEqual(s["pos"][0], 2.994)
        self.assertAlmostEqual(s["pos"][1], -0.85)
        self.assertEqual(s["n"], (-1.0, 0.0))
        self.assertEqual(s["door"], 1)

    def test_beta_skips_side_blocked_by_furniture(self):
        s = choose_switch_spot("beta", "Beta", [OP], set(), locate, blocked)
        self.assertAlmostEqual(s["pos"][0], 3.206)
        self.assertAlmostEqual(s["pos"][1], -1.95)

    def test_override_side(self):
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked, {"side": -1})
        self.assertAlmostEqual(s["pos"][1], -1.95)

    def test_override_side_keeps_spot_with_furniture_in_front(self):
        s = choose_switch_spot("beta", "Beta", [OP], set(), locate, blocked, {"door": 1, "side": 1})
        self.assertAlmostEqual(s["pos"][0], 3.206)
        self.assertAlmostEqual(s["pos"][1], -0.85)

    def test_override_side_still_needs_a_wall(self):
        wall_ends = lambda x, z: 3.0 <= x <= 3.2 and -1.9 <= z <= -0.9  # noqa: E731
        self.assertIsNone(choose_switch_spot("beta", "Beta", [OP], set(), locate, wall_ends, {"side": 1}))

    def test_face_outside_uses_the_other_rooms_face(self):
        # Alpha's switch on Beta's face: side +1 has the shelf in front, so side -1 is used.
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked, {"door": 1, "face": "outside"})
        self.assertAlmostEqual(s["pos"][0], 3.206)
        self.assertAlmostEqual(s["pos"][1], -1.95)
        self.assertEqual(s["n"], (1.0, 0.0))
        s = choose_switch_spot("alpha", "Alpha", [OP], set(), locate, blocked, {"face": "outside", "side": 1})
        self.assertAlmostEqual(s["pos"][0], 3.206)
        self.assertAlmostEqual(s["pos"][1], -0.85)

    def test_infilled_or_unrelated_doors_give_none(self):
        self.assertIsNone(choose_switch_spot("alpha", "Alpha", [OP], {1}, locate, blocked))
        self.assertIsNone(choose_switch_spot("gamma", "Gamma", [OP], set(), locate, blocked))


if __name__ == "__main__":
    unittest.main()
