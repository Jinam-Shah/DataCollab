# DataCollab demo data dictionary

This workspace holds three public tables from US federal agencies. This document explains what
the columns mean and the traps to avoid when querying them.

# earthquakes

Every earthquake of magnitude 4.5 or larger anywhere in the world during calendar year 2024,
from the USGS Earthquake Hazards Program event catalog. One row per event.

## Columns

- `event_id`: the USGS event identifier, unique per row.
- `time`: origin time of the event in UTC (timestamp with time zone).
- `latitude`, `longitude`: epicenter in decimal degrees. Negative latitude is the Southern Hemisphere.
- `depth_km`: depth of the hypocenter below the surface, in kilometers. Events deeper than 300 km are called deep-focus earthquakes.
- `magnitude`: the preferred magnitude reported by USGS.
- `mag_type`: the method used for the magnitude. `mb` is body-wave magnitude, common for moderate distant events. `mww` is moment magnitude from the W-phase, used for larger events. `ml` is local magnitude.
- `place`: a text description of the nearest named place, for example "15 km S of Hualien City, Taiwan".
- `network`: the contributing seismic network code, stored in lowercase (for example `us` or `ak`).

## Notes

The time column is in UTC, so a date filter such as "January 1" means the UTC calendar day.
Every row has status "reviewed" and event type "earthquake", so those columns carry no information.

# causes_of_death

Leading causes of death in the United States from 1999 to 2017, by state, from the CDC National
Center for Health Statistics (NCHS). One row per year, cause and state.

## Columns

- `year`: calendar year of death.
- `cause`: short cause name, such as Heart disease, Cancer, Unintentional injuries or Suicide.
- `state`: a state name, "District of Columbia", or "United States" for the national total.
- `deaths`: number of deaths.
- `age_adjusted_death_rate`: deaths per 100,000 people, adjusted to the 2000 US standard population so that states with older or younger populations can be compared fairly.

## Caveats

The cause value "All causes" is the total of every cause of death for that state and year, not
only the causes listed. Do not add it to the other causes, or deaths are counted twice.

The state value "United States" is the national total. Do not add it to the state rows, or the
national figure is counted twice. Use it directly for national questions.

# state_population

Census Bureau population estimates (Vintage 2019) for the 50 states and the District of Columbia.

## Columns

- `state`: state name, matching the `state` column of causes_of_death.
- `state_fips`: two-digit FIPS code. It is stored as an integer, so leading zeros are dropped (Alabama is 1, not 01).
- `region` and `division`: Census Bureau region (Northeast, Midwest, South, West) and division.
- `pop_2010`, `pop_2015`, `pop_2017`, `pop_2019`: July 1 population estimates for those years.

## Joining

Join causes_of_death to state_population on the state name to get rates per person or totals by
region. The "United States" rows in causes_of_death have no match, which is usually what you want.
