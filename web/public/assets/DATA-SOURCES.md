# Data sources

`climate.json` is built by `web/scripts/fetch-climate.mjs` (the request URLs and fetch date are in its `source` field).

- **PVGIS 5.3**, European Commission Joint Research Centre: average daily irradiance profile per month (beam, diffuse and clear-sky irradiance on a horizontal surface) at 41.117327, −8.653914, from the SARAH3 satellite data, 2005–2023. https://re.jrc.ec.europa.eu/pvg_tools/ — © European Union, reuse allowed with acknowledgement of the source.
- **Open-Meteo Historical Weather API**: daily sunshine duration and mean cloud cover, 2015–2024, averaged per month. https://open-meteo.com/ — data licensed under CC BY 4.0 (based on ERA5 / Copernicus Climate Change Service). These figures are kept in `climate.json` for reference but not shown in the viewer, because they run high against observed sunshine in Porto (12.9 h in June against about 10 h).
