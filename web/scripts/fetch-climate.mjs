// Builds public/assets/climate.json: an average day for each month at the flat (PVGIS, SARAH3 2005-2023)
// and its typical sunshine and cloud cover (Open-Meteo archive, 2015-2024).
// Run from web/:  node scripts/fetch-climate.mjs 41.117327 -8.653914
import { writeFile } from 'node:fs/promises';

const [lat, lon] = process.argv.slice(2).map(Number);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('usage: node scripts/fetch-climate.mjs <lat> <lon>');
  process.exit(1);
}
const pvgis = `https://re.jrc.ec.europa.eu/api/v5_3/DRcalc?lat=${lat}&lon=${lon}&month=0&global=1&clearsky=1&angle=0&aspect=0&outputformat=json`;
const openMeteo = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=2015-01-01&end_date=2024-12-31&daily=sunshine_duration,cloud_cover_mean&timezone=Europe%2FLisbon`;

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'apartment-walkthrough climate fetch' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const [p, o] = await Promise.all([json(pvgis), json(openMeteo)]);
const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, hours: [], sunshine: [], cloud: [] }));
// PVGIS gives hourly means in UTC; "12:00" is the hour from 12:00 to 13:00, so it sits at 12.5.
for (const r of p.outputs.daily_profile) {
  const hour = Number(r.time.slice(0, 2));
  months[r.month - 1].hours[hour] = {
    utcHour: hour + 0.5, gb: round(r['Gb(i)'], 1), gd: round(r['Gd(i)'], 1), gcs: round(r['Gcs(i)'], 1),
  };
}
o.daily.time.forEach((day, k) => {
  const m = months[Number(day.slice(5, 7)) - 1];
  if (o.daily.sunshine_duration[k] !== null) m.sunshine.push(o.daily.sunshine_duration[k] / 3600);
  if (o.daily.cloud_cover_mean[k] !== null) m.cloud.push(o.daily.cloud_cover_mean[k]);
});
const out = {
  source: { pvgis, openMeteo, fetched: new Date().toISOString().slice(0, 10) },
  months: months.map((m) => {
    if (m.hours.length !== 24 || m.hours.some((h) => !h)) throw new Error(`PVGIS month ${m.month}: expected 24 hours`);
    return { month: m.month, hours: m.hours, sunshineHours: round(mean(m.sunshine), 1), cloudCover: Math.round(mean(m.cloud)) };
  }),
};
await writeFile(new URL('../public/assets/climate.json', import.meta.url), JSON.stringify(out) + '\n');
console.log('wrote public/assets/climate.json');
