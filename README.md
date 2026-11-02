# HeatEquity

**Who is most exposed to extreme heat?** A seven-day heat-risk monitor for cities across South Asia and Europe. It ranks places with a transparent, adjustable index that combines forecast heat, departure from the local normal, population vulnerability and land cover.

**Live site:** `https://<your-username>.github.io/<repo-name>/`

## Data

| Layer | Source |
|---|---|
| 7-day forecast, current conditions | [Open-Meteo](https://open-meteo.com), rebuilt every 6 hours, plus a live reading on city click |
| 1991–2020 monthly normal maximum temperature | [NASA POWER](https://power.larc.nasa.gov), cached after the first run |
| Built-up and tree cover, 8×8 neighbourhood grid | [ESA WorldCover 2021](https://esa-worldcover.org) (10 m), cached after the first run |
| Cities, population | [GeoNames](https://www.geonames.org) |
| Share aged 65+, urban share (national) | [World Bank Open Data](https://data.worldbank.org) |
| AI briefing | Llama 3.3 70B on [Groq](https://groq.com), written at build time from the figures above |

`pipeline/build_data.py` writes `site/data/cities.json`; the static page in `site/` (MapLibre GL, no build step) reads it. Normals, land cover and the briefing are optional layers: if one fails, the site still builds without it.

**Risk index** = 100 × hazard × (0.4 + 0.6 × vulnerability). Hazard can be absolute, relative to the local normal, or a blend. Vulnerability is a weighted average of percentile ranks that you can adjust in the app.

## Deploy

1. Push to GitHub (branch `main`). Settings → Pages → Source: **GitHub Actions**.
2. Optional AI briefing: Settings → Secrets and variables → Actions → new secret `GROQ_API_KEY`.
3. Actions → *Build and deploy* → Run workflow. The first run is slow because it reads land cover for every city. Later runs reuse the cache.

The AI key lives only in GitHub Secrets. Visitors can ask follow-up questions with their own Groq key, which stays in their browser tab.

## Limits

National indicators cannot separate neighbourhoods, and there is no data on outdoor workers or cooling access. The land-cover grid is a 2021 proxy for heat retention, not measured surface temperature. Forecasts are model output and the AI text can contain errors. This is an independent project, not an official warning system.

Open-Meteo's free tier is for non-commercial use. Open-Meteo, GeoNames, World Bank and WorldCover data are CC BY 4.0.
