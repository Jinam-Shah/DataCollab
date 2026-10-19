// Download the public demo dataset and write tidy CSVs to eval/data/.
//   node scripts/fetch_demo_data.js
// All three sources are US federal government works (public domain). See eval/data/README.md.
const fs = require('fs');
const path = require('path');
const { parse } = require('./lib/csvLines');

const OUT = path.join(__dirname, '..', 'eval', 'data');
const SOURCES = {
  earthquakes:
    'https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2024-01-01&endtime=2025-01-01&minmagnitude=4.5&orderby=time-asc',
  deaths: 'https://data.cdc.gov/api/views/bi63-dtpu/rows.csv?accessType=DOWNLOAD',
  census:
    'https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/national/totals/nst-est2019-alldata.csv',
};

const REGIONS = { 1: 'Northeast', 2: 'Midwest', 3: 'South', 4: 'West' };
const DIVISIONS = {
  1: 'New England',
  2: 'Middle Atlantic',
  3: 'East North Central',
  4: 'West North Central',
  5: 'South Atlantic',
  6: 'East South Central',
  7: 'West South Central',
  8: 'Mountain',
  9: 'Pacific',
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function write(name, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, name), text);
  console.log(`${name}: ${rows.length} rows`);
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // USGS: every magnitude 4.5+ earthquake worldwide in 2024.
  const quakes = parse(await get(SOURCES.earthquakes));
  write(
    'earthquakes.csv',
    [
      'event_id',
      'time',
      'latitude',
      'longitude',
      'depth_km',
      'magnitude',
      'mag_type',
      'place',
      'event_type',
      'status',
      'network',
    ],
    quakes.map((q) => [
      q.id,
      q.time,
      q.latitude,
      q.longitude,
      q.depth,
      q.mag,
      q.magType,
      q.place,
      q.type,
      q.status,
      q.net,
    ])
  );

  // CDC NCHS: leading causes of death by state, 1999-2017.
  const deaths = parse(await get(SOURCES.deaths));
  write(
    'causes_of_death.csv',
    ['year', 'cause', 'state', 'deaths', 'age_adjusted_death_rate'],
    deaths.map((d) => [d.Year, d['Cause Name'], d.State, d.Deaths, d['Age-adjusted Death Rate']])
  );

  // Census Bureau: state population estimates (50 states + DC).
  const census = parse(await get(SOURCES.census)).filter(
    (c) => c.SUMLEV === '040' && c.STATE !== '72'
  );
  write(
    'state_population.csv',
    ['state', 'state_fips', 'region', 'division', 'pop_2010', 'pop_2015', 'pop_2017', 'pop_2019'],
    census.map((c) => [
      c.NAME,
      c.STATE,
      REGIONS[c.REGION],
      DIVISIONS[c.DIVISION],
      c.POPESTIMATE2010,
      c.POPESTIMATE2015,
      c.POPESTIMATE2017,
      c.POPESTIMATE2019,
    ])
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
