# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-stage synthetic-data project for a European retailer's sports-equipment **rental** business
(analytics-engineering portfolio / interview prep, all data 100% synthetic):

1. `generate_dataset.py` → writes 4 CSVs + a data-dictionary `output/README.md`.
2. `rental_analysis.ipynb` → business analysis that **consumes** those CSVs.

The pipeline is one-directional: the generator produces `output/`, the notebook reads it.
There is no application, server, or package — just a script and a notebook.

## Environment

- Windows 11, PowerShell primary shell. Python 3.13.
- No virtualenv is committed; dependencies are installed into the active interpreter.

## Commands

```bash
# Install all dependencies (dataset + notebook stack)
python -m pip install -r requirements.txt

# Regenerate the dataset (deterministic; overwrites output/)
python generate_dataset.py

# Validate the notebook end-to-end (this is the closest thing to a test suite):
# executes every cell headless against the real CSVs, fails on any cell error.
# NEVER set MPLBACKEND=Agg here: the notebook has no `%matplotlib inline`, so it
# relies on the kernel's inline backend. Agg overrides it, the run still "passes"
# with zero errors, and all 13 figures vanish from the committed notebook.
python -m nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=900 rental_analysis.ipynb

# Rebuild the interactive HTML report and run its two test suites
python docs/build_report.py
python docs/verify_report.py    # numbers: vs pandas/scipy/statsmodels (runs Node internally)
node    docs/test_render.js     # pages: 8 pages x 4 filter scenarios, must not throw
```

There is **no lint config and no test framework**. "Passing" means: the generator runs
clean and the notebook executes with zero error outputs. After any code change, re-run
both commands above. To confirm the notebook has no error cells, read it back with
`nbformat` and count outputs where `output_type == "error"` (should be 0).

`.github/workflows/ci.yml` runs exactly those checks on every push. Two things it relies on:

- **`constraints.txt` pins the versions that produced the committed CSVs.** Byte-identical
  regeneration only holds within the same numpy/pandas/faker. CI installs with
  `pip install -r requirements.txt -c constraints.txt`. Bumping a pin is a deliberate act:
  update it, regenerate, review the diff, commit data and pin together.
- **`docs/` is the GitHub Pages root, so Pages serves the *committed* HTML.** Editing
  `docs/report/*` without re-running `build_report.py` silently ships a stale dashboard;
  CI compares a fresh build against the committed one to catch it. That comparison
  normalizes `meta.generated` (the `datetime.now()` at
  `build_report.py`, ~line 363) — the only non-deterministic byte in the build. If you add
  another wall-clock or random value to the payload, that check starts failing daily.

## Reproducibility contract (critical)

`generate_dataset.py` is fully deterministic via a single `numpy.random.Generator`
(`SEED = 42`, line ~47) plus seeded `random` and `Faker`. Two runs produce byte-identical
CSVs. Consequences when editing the generator:

- `N_RENTALS` is **drawn from `rng`** (`rng.integers(170_000, 190_001)`), not a constant.
  Any change that adds/removes/reorders an earlier `rng` draw shifts the entire downstream
  stream and changes every file. Do not reorder random calls casually.
- Keep all randomness flowing through `rng` (not `np.random.*` global) to preserve this.

## Time window (`START_DATE` … `END_DATE`, currently 2022-01-01 → 2026-07-31, 55 months)

Widening it touches more than the two constants. Everything below is coupled:

- **`N_RENTALS` does not scale with the window.** Move the dates without moving the volume
  and monthly demand silently halves — every monthly KPI drops with no cause in the domain.
  Sized for ~3,250 rentals/month.
- **`YEAR_GROWTH` must cover every year in range.** A missing year falls back to 1.0, which
  is invisible in the code and very visible as a step in the report's monthly series.
- **`build_holidays`'s `easter` dict must cover every year too**, or that year loses its
  Easter peak and its seasonality quietly differs from the rest.
- **`SNAPSHOT_DATE` must stay after `END_DATE`**, and customer tenure (`generate_customers`,
  ~9 years) must reach comfortably before `START_DATE`: rentals can only be assigned to
  customers already signed up, so a short tenure range starves the first months.
- **`PERIODS` in `report/05_ui.js`** lists the year filters by hand — a year with data but
  no entry there simply cannot be filtered.

`generate_rentals` picks the customer by inverse-CDF over the *eligible prefix* (those whose
`signup_date` ≤ the rental date), weighted by activity. Before that, customers were drawn
from the whole roster and 21 % of rentals predated their own customer's signup. The
`rental_date < signup_date del cliente` rule in `quality_report` exists to keep it at 0.

## Generator architecture (`generate_dataset.py`)

Organized as config → per-entity generator functions → quality injection → export,
orchestrated by `main()`. Numbered section banners (`# 1.` … `# 8.`) mark the flow.

- **`CATEGORY_CONFIG`** is the single source of truth for per-category business behavior
  (seasonal demand weights, base price, purchase-price range, avg rental days, damage
  intensity, lead time, retailer sub-brands). To add/modify a sport category, edit this
  dict only — seasonality, pricing, product catalog, and damage all derive from it.
- Other catalogs: `CITY_CATALOG` (city, country, tourism flag), `STORE_SIZE_CONFIG`,
  `COUNTRY_PRICE_FACTOR`, segment/membership maps.
- Generation order matters and encodes causality: date → season → category (seasonal
  weights) → product → store/customer → derived variables (duration, cancellation,
  return, damage, price, review). Variables are **derived from each other**, not
  independent; `generate_rentals` is where the business rules live.
- Data-quality problems (duplicates, nulls, impossible values, bad dates, misspelled
  categories, inconsistent casing) are **injected on purpose** in `inject_quality_issues`
  as the last step. Do NOT "fix" these in the generator — the notebook is built to detect
  and clean them. Keep injected rates small (~1–2%).
- Helper columns are prefixed `_` (e.g. `_tourism`, `_activity_weight`,
  `_damage_intensity`) and stripped by `_drop_helpers` before CSV export.
- `write_readme()` generates `output/README.md`. That file is **auto-generated** — edit
  the function, never the output file by hand.
- `membership_level` uses the literal `"Basic"` (never `"None"`) on purpose: pandas
  `read_csv` parses the string `"None"` as `NaN`, which would silently drop that group.

## Interactive report (`docs/`)

`docs/build_report.py` concatenates the pieces in `docs/report/` into
`docs/informe.html`: a self-contained 8-page dashboard (no CDN, no server, no build
tooling, ~2.3 MB). **Edit the pieces, never `informe.html`** — it is generated.

```
report/01_head.html   tokens + CSS          report/05_ui.js       cards, filters, render loop
report/02_body.html   markup shell          report/06_pages_a.js  pages 1-4
report/03_core.js     engine (no DOM)       report/07_pages_b.js  pages 5-8 + PAGES index
report/03b_geo.js     country outlines      report/04_charts.js   SVG chart library
```

Key invariants:

- **`03_core.js` must stay DOM-free.** `docs/test_report.js` loads that exact file in Node
  to check the engine against pandas/scipy/statsmodels. One `document.` reference there
  and the whole numeric test suite stops running.
- The builder **re-implements the notebook's cleaning pipeline and KPI definitions**
  (`clean_rentals`, `dedupe_rental_ids`, `data_trust_score`). Change a metric in the
  notebook and it must change here too; `verify_report.py` is what catches the drift.
- The full 172k-row fact table is embedded as columnar binary → deflate → base64 (~2.1 MB),
  **not** pre-aggregated, so every filter cross-tabulates exactly and the regressions
  refit on the current slice. Only non-derivable columns are encoded; category, country,
  season and store size resolve via lookups in JS. Rows are sorted by product+month+day
  before compressing (saves ~200 KB).
- **Denominator trap:** ticket medio and duración media divide by the count of rentals that
  actually have a price/duration, not by all completed rentals — matching `global_kpis`.
  Getting this wrong shifts the ticket by ~1.6 € and silently desyncs the report.
- `"use strict"` is injected by `assemble()` as the script's first statement. Inside the
  concatenated pieces it would just be a stray string literal with no effect.
- `docs/_informe_fragment.html` is the same page without `<html>/<head>/<body>`, for
  publishing as an Artifact. Gitignored — a build byproduct, not a source.
- Charts are hand-written SVG. The palette is the dataviz reference palette with `#0082C3`
  in slot 1, validated in light and dark; re-run the validator if you change any hue.
- **The map uses no mapping library and no tiles, on purpose.** Leaflet/MapLibre need a tile
  server, and the Artifact CSP blocks every external host — tiles would silently never load
  there. Borders are embedded in `report/03b_geo.js`, generated once by `docs/make_geo.py`
  from Natural Earth 50m (public domain) and versioned; the build stays offline. Regenerate
  only if the map window or the business-country list changes.
- **Mercator needs both axes in the same unit.** `mercY` returns *degrees*
  (`ln(tan(…)) · 180/π`); the x axis is degrees of longitude. Returning raw radians squashes
  the map vertically by ~57× — it still renders, still passes `test_render.js`, and looks
  like a thin band of bubbles. Cross-check with `cities inside their own country polygon`,
  never by re-deriving the same formula in the test.
- No browser is available in this environment, so `test_render.js` stubs a minimal DOM and
  renders all 8 pages under 4 filter scenarios. It proves nothing about *looks* — only that
  the page code runs. Visual regressions still need a human to open the file.

## Data model

Star schema. `rentals` is the fact table; `customers`, `products`, `stores` are
dimensions (`1—N` each into `rentals`). Full column dictionary, cardinalities, and KPI
definitions are in `output/README.md`.

## Notebook architecture (`rental_analysis.ipynb`)

10 numbered sections: intro/KPIs → load & PK/FK validation → Data Quality (+ a composite
"Data Trust Score") → feature engineering → SQL → EDA → statistics → insights →
recommendations → productionization. Design intent: a business narrative, not a
gallery of charts — every figure answers a stated question and is followed by an
actionable insight.

Key mechanisms a future edit must preserve:

- **`%%sql` cells run locally via DuckDB**, not Databricks. An early cell registers a
  custom IPython cell-magic `sql` that calls `duckdb.sql(cell).df()`. It works because
  the magic is defined inside the notebook, so DuckDB's *replacement scan* resolves bare
  table names (`fact`, `product_metrics`, `store_metrics`, `customer_metrics`) to the
  DataFrame variables in the notebook namespace. SQL cells therefore depend on those
  DataFrames existing (created in the feature-engineering section) with those exact names.
  The same queries run under native `%sql` in Databricks.
- **statsmodels/patsy + nullable dtypes:** columns cleaned with `standardize_text` become
  pandas `string` dtype carrying `pd.NA`, which breaks patsy formula parsing
  ("boolean value of NA is ambiguous"). The OLS and Logit cells defensively
  `astype(object)` + `dropna(subset=...)` the model columns first — keep that pattern
  when touching section 7.
- Metric definitions live in reusable functions (`build_product_metrics`,
  `build_store_metrics`, `build_customer_metrics`, `global_kpis`) — the seed of a future
  metrics/semantic layer. Change a KPI definition in one place.
- The optional PySpark cell is gated behind `RUN_PYSPARK = False` and wrapped in
  `try/except`; local Spark is not expected to work on this Windows box (no Hadoop/
  winutils). Leave it disabled by default.

If you regenerate the notebook programmatically (it was originally assembled with
`nbformat`), the build script is not tracked in the repo — the `.ipynb` itself is the
source of truth. Always re-validate with the `nbconvert --execute` command above.
