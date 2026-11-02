#!/usr/bin/env python3
"""Builds site/data/cities.json: GeoNames (cities), World Bank (national indicators), Open-Meteo (7-day
forecast), NASA POWER (1991-2020 normals), ESA WorldCover (land cover) and an optional Groq briefing
(needs the GROQ_API_KEY secret). Normals, land cover and the briefing are optional: if one fails, the
build still ships without it."""
import csv, io, json, math, os, pathlib, time, urllib.request, zipfile
from datetime import datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "site" / "data" / "cities.json"
CACHE = HERE / "cache"
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
WORLDCOVER = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
MODEL = "llama-3.3-70b-versatile"
SYSTEM = ("You are a climate-adaptation analyst writing for policymakers. Use only the figures supplied; never invent "
          "numbers, events or causes, and say when a figure is missing. British English, plain prose, no bullet points. "
          "Return JSON with the keys all, south_asia and europe. Each value is 90 to 130 words: the situation over the "
          "next three days, which cities are most exposed and why (use age, urbanisation, built-up and tree cover and "
          "departure from normal where given), and two practical priorities.")
REGIONS = {
    "South Asia": "AF BD BT IN LK MV NP PK".split(),
    "Europe": ("AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME "
               "NL MK NO PL PT RO RS SK SI ES SE CH UA GB").split(),
}
LARGE = set("IN PK BD DE FR GB IT ES PL UA".split())  # 30 cities each; others 8 (+ capital)
HEADERS = {"User-Agent": "HeatEquity/1.0 (open-source GitHub Pages project)"}


def fetch(url, tries=5, required=True, data=None, headers=None):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**HEADERS, **(headers or {})})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {i + 1}/{tries}: {e}", flush=True)
            time.sleep(20 * (i + 1) if required else 3)
    if required:
        raise SystemExit(f"Failed to fetch {url}")  # job fails, so the last good deploy stays live
    return None


def load(name):
    p = CACHE / name
    return json.loads(p.read_text()) if p.exists() else {}


def save(name, obj):
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / name).write_text(json.dumps(obj))


def pick_cities():
    z = zipfile.ZipFile(io.BytesIO(fetch("https://download.geonames.org/export/dump/cities15000.zip")))
    rows = csv.reader(io.TextIOWrapper(z.open("cities15000.txt"), encoding="utf-8"),
                      delimiter="\t", quoting=csv.QUOTE_NONE)
    region = {cc: r for r, ccs in REGIONS.items() for cc in ccs}
    by = {}
    for x in rows:
        if x[8] in region:
            by.setdefault(x[8], []).append(dict(
                id=int(x[0]), name=x[1], cc=x[8], reg=region[x[8]],
                lat=round(float(x[4]), 2), lon=round(float(x[5]), 2), pop=int(x[14]),
                elev=int(x[15]) if x[15] else None, cap=x[7] == "PPLC"))
    out = []
    for cc, lst in by.items():
        lst.sort(key=lambda c: -c["pop"])
        k = 30 if cc in LARGE else 8
        out += lst[:k] + [c for c in lst[k:] if c["cap"]]
    return out


def worldbank(codes):
    names, ind = {}, {}
    for key, code in (("p65", "SP.POP.65UP.TO.ZS"), ("urb", "SP.URB.TOTL.IN.ZS")):
        url = (f"https://api.worldbank.org/v2/country/{';'.join(codes)}/indicator/{code}"
               "?format=json&mrnev=1&per_page=500")
        data = json.loads(fetch(url))
        rows = data[1] if len(data) > 1 and data[1] else []
        if not rows:
            print(f"WARNING: no World Bank rows for {code}: {str(data)[:200]}")
        for r in rows:
            cid = r["country"]["id"]
            names[cid] = r["country"]["value"]
            if r["value"] is not None:
                ind.setdefault(cid, {})[key] = round(r["value"], 1)
    return names, ind


def add_weather(cities):
    for i in range(0, len(cities), 50):
        b = cities[i:i + 50]
        url = ("https://api.open-meteo.com/v1/forecast?latitude=" + ",".join(str(c["lat"]) for c in b)
               + "&longitude=" + ",".join(str(c["lon"]) for c in b)
               + "&daily=temperature_2m_max,apparent_temperature_max"
               + "&current=temperature_2m,apparent_temperature,relative_humidity_2m"
               + "&timezone=auto&forecast_days=7")
        res = json.loads(fetch(url))
        res = res if isinstance(res, list) else [res]
        for c, r in zip(b, res):
            d, cur = r["daily"], r.get("current", {})
            c["d"], c["tx"], c["at"] = d["time"], d["temperature_2m_max"], d["apparent_temperature_max"]
            c["now"] = [cur.get("temperature_2m"), cur.get("apparent_temperature"),
                        cur.get("relative_humidity_2m")]
        print(f"  weather {min(i + 50, len(cities))}/{len(cities)}", flush=True)
        time.sleep(20)  # stay far below the free tier's per-minute limit


def add_normals(cities):
    """1991-2020 monthly mean of daily maximum temperature (NASA POWER); departure = forecast max minus normal."""
    cache, fails = load("normals.json"), 0
    for c in cities:
        k = f"{c['lat']},{c['lon']}"
        if k not in cache and fails < 10:
            raw = fetch("https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX&community=RE"
                        f"&longitude={c['lon']}&latitude={c['lat']}&format=JSON", tries=2, required=False)
            try:
                p = json.loads(raw)["properties"]["parameter"]["T2M_MAX"]
                vals = [p[m] for m in MONTHS]
                if min(vals) > -90:
                    cache[k], fails = vals, 0
                    time.sleep(0.3)
            except Exception:
                fails += 1
        n = cache.get(k)
        c["an"] = [round(t - n[int(d[5:7]) - 1], 1) if n and t is not None else None for t, d in zip(c["tx"], c["d"])]
    save("normals.json", cache)
    print(f"  normals for {sum(1 for c in cities if c['an'][0] is not None)} of {len(cities)} cities")


def cell_stats(src, lat, lon):
    """Built-up (class 50) and tree (class 10) share in an 8x8 grid over a 10 km box centred on the city."""
    import numpy as np
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    dla = 5 / 111.32
    dlo = dla / math.cos(math.radians(lat))
    w = from_bounds(lon - dlo, lat - dla, lon + dlo, lat + dla, src.transform)
    a = src.read(1, window=w, boundless=True, fill_value=0, out_shape=(400, 400), resampling=Resampling.nearest)
    cells = lambda m: m.reshape(8, 50, 8, 50).sum(axis=(1, 3))
    v, b, tr = cells(a > 0), cells(a == 50), cells(a == 10)
    if not v.sum():
        raise ValueError("no land cover data")
    pc = lambda x: np.where(v > 0, np.round(100 * x / np.maximum(v, 1)), -1).astype(int).ravel().tolist()
    tot = lambda x: int(round(100 * x.sum() / v.sum()))
    return dict(b=tot(b), t=tot(tr), gb=pc(b), gt=pc(tr))


def add_landcover(cities):
    try:
        import rasterio
    except ImportError:
        print("rasterio not installed: skipping land cover")
        return
    cache, tiles, fails = load("landcover.json"), {}, 0
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for c in cities:
            k = str(c["id"])
            if k not in cache and fails < 10:
                try:
                    la, lo = math.floor(c["lat"] / 3) * 3, math.floor(c["lon"] / 3) * 3
                    t = f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"
                    if t not in tiles:
                        tiles[t] = rasterio.open(WORLDCOVER.format(t=t))
                    cache[k], fails = cell_stats(tiles[t], c["lat"], c["lon"]), 0
                except Exception as e:
                    fails += 1
                    print(f"  land cover skipped for {c['name']}: {e}")
            if k in cache:
                c.update(cache[k])
    save("landcover.json", cache)
    print(f"  land cover for {sum(1 for c in cities if 'gb' in c)} of {len(cities)} cities")


def add_briefing(cities):
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        print("GROQ_API_KEY not set: skipping AI briefing")
        return None

    def facts(c):
        at3 = [x for x in c["at"][:3] if x is not None]
        an3 = [x for x in c["an"][:3] if x is not None]
        f = dict(city=c["name"], country=c["cn"], population=c["pop"], apparent_max_c_next_3_days=max(at3),
                 departure_from_normal_c=max(an3) if an3 else None, aged_65_plus_pct=c.get("p65"),
                 urban_pct=c.get("urb"), built_up_pct=c.get("b"), tree_cover_pct=c.get("t"))
        return {k: v for k, v in f.items() if v is not None}

    data = {}
    for region, name in (("south_asia", "South Asia"), ("europe", "Europe")):
        L = [c for c in cities if c["reg"] == name and any(x is not None for x in c["at"][:3])]
        L.sort(key=lambda c: -max(x for x in c["at"][:3] if x is not None))
        data[region] = [facts(c) for c in L[:10]]
    body = json.dumps({"model": MODEL, "temperature": 0.2, "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": SYSTEM},
                                    {"role": "user", "content": "Hottest cities per region, next 3 days:\n" + json.dumps(data)}]}).encode()
    raw = fetch("https://api.groq.com/openai/v1/chat/completions", tries=2, required=False, data=body,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        text = json.loads(json.loads(raw)["choices"][0]["message"]["content"])
        return {"text": {k: str(text[k]) for k in ("all", "south_asia", "europe")}, "model": MODEL}
    except Exception as e:
        print(f"WARNING: AI briefing failed: {e}")
        return None


def main():
    cities = pick_cities()
    print(f"{len(cities)} cities selected")
    names, ind = worldbank(sorted({c["cc"] for c in cities}))
    for c in cities:
        c["cn"] = names.get(c["cc"], c["cc"])
        c.update(ind.get(c["cc"], {}))
    add_weather(cities)
    cities = [c for c in cities if "at" in c]
    add_normals(cities)
    add_landcover(cities)
    briefing = add_briefing(cities)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    meta = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "cities": len(cities), "countries": len({c["cc"] for c in cities})}
    OUT.write_text(json.dumps({"meta": meta, "briefing": briefing, "cities": cities}, separators=(",", ":"), ensure_ascii=False),
                   encoding="utf-8")
    print(f"Wrote {OUT} ({meta['cities']} cities, {meta['countries']} countries)")


if __name__ == "__main__":
    main()
