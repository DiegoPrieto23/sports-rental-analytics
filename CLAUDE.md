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
python -m nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=300 rental_analysis.ipynb
```

There is **no lint config and no test framework**. "Passing" means: the generator runs
clean and the notebook executes with zero error outputs. After any code change, re-run
both commands above. To confirm the notebook has no error cells, read it back with
`nbformat` and count outputs where `output_type == "error"` (should be 0).

## Reproducibility contract (critical)

`generate_dataset.py` is fully deterministic via a single `numpy.random.Generator`
(`SEED = 42`, line ~47) plus seeded `random` and `Faker`. Two runs produce byte-identical
CSVs. Consequences when editing the generator:

- `N_RENTALS` is **drawn from `rng`** (`rng.integers(75_000, 100_001)`), not a constant.
  Any change that adds/removes/reorders an earlier `rng` draw shifts the entire downstream
  stream and changes every file. Do not reorder random calls casually.
- Keep all randomness flowing through `rng` (not `np.random.*` global) to preserve this.

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
