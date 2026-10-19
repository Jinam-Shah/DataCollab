# Demo dataset

Three CSVs from US federal government sources. Works of the US federal government are in the
public domain. Regenerate them with `npm run fetch:demo-data` (`scripts/fetch_demo_data.js`);
the files here were downloaded on 2026-10-19.

| File | Rows | Source |
|---|---|---|
| `earthquakes.csv` | 6,397 | USGS Earthquake Hazards Program, FDSN event web service: every magnitude 4.5+ event worldwide from 2024-01-01 to 2024-12-31 (UTC). https://earthquake.usgs.gov/fdsnws/event/1/ |
| `causes_of_death.csv` | 10,868 | CDC / NCHS, "Leading Causes of Death: United States", 1999-2017, by state (dataset `bi63-dtpu` on data.cdc.gov, listed on data.gov). Includes a `United States` row per year and cause, and an `All causes` total per state and year. |
| `state_population.csv` | 51 | US Census Bureau, Vintage 2019 population estimates (`nst-est2019-alldata.csv`), 50 states plus DC, with Census region and division names. |

Changes made by the script: columns renamed to snake_case, a subset of columns kept, the long
"113 Cause Name" column dropped, and Census region/division codes replaced with their names.
No values were edited.

The `All causes` and `United States` rows are kept on purpose: summing every row double-counts,
which is one of the traps in the evaluation questions.
