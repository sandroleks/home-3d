"""Sun position (NOAA solar calculator equations, after Meeus), Lisbon time and the typical-month irradiance.

Mirrors web/src/sun.ts and web/src/climate.ts so Cycles reference renders use the same sun as the viewer.
"""
import calendar
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MIN_ELEVATION = 3.0


def _refraction(elev):
    if elev > 85:
        return 0.0
    t = math.tan(math.radians(elev))
    if elev > 5:
        r = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5
    elif elev > -0.575:
        r = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))
    else:
        r = -20.772 / t
    return r / 3600


def solar_position(utc_seconds, lat, lon):
    """(azimuth clockwise from north, apparent elevation) in degrees."""
    jd = utc_seconds / 86400 + 2440587.5
    t = (jd - 2451545) / 36525
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t) + math.sin(3 * mr) * 0.000289)
    omega = math.radians(125.04 - 1934.136 * t)
    apparent = math.radians(l0 + c - 0.00569 - 0.00478 * math.sin(omega))
    eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
    eps = math.radians(eps0 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(apparent))
    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    eq_time = 4 * math.degrees(y * math.sin(2 * l0r) - 2 * e * math.sin(mr)
                               + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
                               - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))
    minutes = (utc_seconds % 86400) / 60
    true_solar = (minutes + eq_time + 4 * lon) % 1440
    hour_angle = true_solar / 4 - 180
    latr, har = math.radians(lat), math.radians(hour_angle)
    cos_zenith = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(har)
    zenith = math.acos(max(-1.0, min(1.0, cos_zenith)))
    denom = math.cos(latr) * math.sin(zenith)
    if abs(denom) < 1e-12:
        az = 180.0 if lat > math.degrees(decl) else 0.0
    else:
        a = math.degrees(math.acos(max(-1.0, min(1.0, (math.sin(latr) * math.cos(zenith) - math.sin(decl)) / denom))))
        az = (a + 180) % 360 if hour_angle > 0 else (540 - a) % 360
    elev = 90 - math.degrees(zenith)
    return az, elev + _refraction(elev)


def lisbon_to_utc_seconds(text, tz="Europe/Lisbon"):
    """'2026-12-21T10:00' read as local time in tz -> UTC Unix seconds."""
    return datetime.fromisoformat(text).replace(tzinfo=ZoneInfo(tz)).astimezone(timezone.utc).timestamp()


def blender_direction(az, el, y_bearing):
    """Unit vector toward the sun in Blender space, given the compass bearing of Blender +Y."""
    rel, e = math.radians(az - y_bearing), math.radians(el)
    return (math.sin(rel) * math.cos(e), math.cos(rel) * math.cos(e), math.sin(e))


def _profile(month, hour, key):
    x = (hour - 0.5) % 24
    i = int(math.floor(x))
    f = x - i
    a = month["hours"][i][key]
    return a + (month["hours"][(i + 1) % 24][key] - a) * f


def typical_irradiance(climate, utc_seconds):
    """(beam, diffuse) W/m² on a horizontal surface from climate.json: the month's average day, blended toward the
    neighbouring month away from mid-month, interpolated between hourly means centred on HH:30 UTC."""
    dt = datetime.fromtimestamp(utc_seconds, timezone.utc)
    hour = dt.hour + dt.minute / 60 + dt.second / 3600
    pos = (dt.day - 1 + hour / 24) / calendar.monthrange(dt.year, dt.month)[1]
    m = dt.month - 1
    other = (m - 1) % 12 if pos < 0.5 else (m + 1) % 12
    w = abs(pos - 0.5)
    months = climate["months"]

    def mix(key):
        return (1 - w) * _profile(months[m], hour, key) + w * _profile(months[other], hour, key)

    return mix("gb"), mix("gd")


def sun_strength(beam, el):
    """Direct-normal W/m² from horizontal beam W/m²."""
    if el <= 0:
        return 0.0
    return beam / math.sin(math.radians(max(el, MIN_ELEVATION)))
