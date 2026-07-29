"""Genera los notebooks SQL de Databricks a partir de los modelos dbt.

El proyecto dbt (`databricks/dbt/models`) es la UNICA fuente de verdad de la logica
de negocio. Este script resuelve las funciones Jinja de dbt (`ref`, `source`, `config`)
y escribe tres notebooks SQL listos para importar en Databricks:

    notebooks/01_staging.sql        -> vistas de la capa staging
    notebooks/02_intermediate.sql   -> tablas de la capa intermediate
    notebooks/02b_quality_gate.sql  -> tests que solo dependen de intermediate
    notebooks/03_marts.sql          -> tablas de los Data Marts
    notebooks/04_tests.sql          -> tests que dependen de los marts

Los tests singulares de `dbt/tests/*.sql` se traducen a `assert_true(...)`: si alguno
devuelve filas, la celda lanza un error y el Job se detiene. Los que no dependen de
los marts se colocan ANTES de publicarlos, para que un dato malo nunca llegue a negocio.

Asi, quien no quiera montar dbt puede ejecutar exactamente el mismo SQL desde un Job
de Databricks, y quien si lo monte no tiene dos copias del codigo que mantener.

Uso:
    python databricks/build_databricks_notebooks.py
    python databricks/build_databricks_notebooks.py --catalog main
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS_DIR = HERE / "dbt" / "models"
TESTS_DIR = HERE / "dbt" / "tests"
OUTPUT_DIR = HERE / "notebooks"

# Schema donde viven las tablas CRUDAS (`*_raw`) cargadas con la UI de Databricks.
# Conviven en el mismo schema que las vistas `stg_*`; el sufijo distingue la fuente
# inmutable del modelo. Los nombres exactos se declaran en dbt/models/staging/_sources.yml.
RAW_SCHEMA = "staging"

# Orden de ejecucion dentro de cada capa. Explicito a proposito: dbt resuelve el DAG
# solo, pero un notebook SQL se ejecuta de arriba abajo y el orden importa.
LAYERS: dict[str, dict] = {
    "01_staging": {
        "layer": "staging",
        "schema": "staging",
        "materialization": "VIEW",
        "title": "Capa STAGING · casting, renombrado y estandarizacion (1:1 con la fuente)",
        "models": ["stg_rentals", "stg_products", "stg_stores", "stg_customers"],
    },
    "02_intermediate": {
        "layer": "intermediate",
        "schema": "intermediate",
        "materialization": "TABLE",
        "title": "Capa INTERMEDIATE · deduplicacion, reglas de negocio y tabla de hechos",
        "models": ["int_rentals_deduplicated", "int_rentals_cleaned", "int_rentals_enriched"],
    },
    "03_marts": {
        "layer": "marts",
        "schema": "marts",
        "materialization": "TABLE",
        "title": "Capa MARTS · metricas y KPIs listos para consumo",
        "models": [
            "mart_product_metrics",
            "mart_store_metrics",
            "mart_customer_metrics",
            "mart_global_kpis",
            "mart_monthly_revenue",
            "mart_category_performance",   # depende de mart_product_metrics
            "mart_pricing_by_season",
            "mart_channel_performance",
            "mart_cohort_retention",
            "mart_data_quality",
        ],
    },
}

# Mapa modelo -> schema destino, para resolver los {{ ref() }} entre capas.
MODEL_SCHEMA = {
    model: cfg["schema"]
    for cfg in LAYERS.values()
    for model in cfg["models"]
}

RE_CONFIG = re.compile(r"\{\{\s*config\([^}]*\)\s*\}\}\s*")
RE_REF = re.compile(r"\{\{\s*ref\(\s*['\"](\w+)['\"]\s*\)\s*\}\}")
RE_SOURCE = re.compile(r"\{\{\s*source\(\s*['\"](\w+)['\"]\s*,\s*['\"](\w+)['\"]\s*\)\s*\}\}")


def find_model_file(name: str) -> Path:
    matches = list(MODELS_DIR.rglob(f"{name}.sql"))
    if not matches:
        raise FileNotFoundError(f"No se encuentra el modelo dbt '{name}.sql' en {MODELS_DIR}")
    return matches[0]


def resolve_jinja(sql: str, catalog: str) -> str:
    """Sustituye las funciones Jinja de dbt por nombres cualificados de Databricks."""
    sql = RE_CONFIG.sub("", sql)
    sql = RE_SOURCE.sub(lambda m: f"{catalog}.{RAW_SCHEMA}.{m.group(2)}", sql)
    sql = RE_REF.sub(lambda m: f"{catalog}.{MODEL_SCHEMA[m.group(1)]}.{m.group(1)}", sql)
    if "{{" in sql or "{%" in sql:
        raise ValueError(f"Quedan expresiones Jinja sin resolver:\n{sql[:300]}")
    return sql.strip()


def compile_model(name: str, catalog: str) -> str:
    """Traduce un modelo dbt a SQL puro de Databricks."""
    return resolve_jinja(find_model_file(name).read_text(encoding="utf-8"), catalog)


def build_tests_notebook(test_files: list[Path], catalog: str, title: str) -> str:
    """Traduce los tests singulares de dbt a celdas `assert_true` que rompen el Job."""
    cells = [
        "-- Databricks notebook source",
        f"-- MAGIC %md\n-- MAGIC # {title}\n"
        "-- MAGIC\n"
        "-- MAGIC > Generado desde `dbt/tests/`. Cada celda falla el Job si el test\n"
        "-- MAGIC > devuelve alguna fila. **No editar a mano.**",
    ]
    for path in test_files:
        body = resolve_jinja(path.read_text(encoding="utf-8"), catalog)
        cells.append(f"-- MAGIC %md\n-- MAGIC ### Test: `{path.stem}`")
        cells.append(
            f"SELECT assert_true(\n"
            f"    (SELECT count(*) FROM (\n{body}\n    )) = 0,\n"
            f"    'TEST FALLIDO · {path.stem}: hay filas que violan la regla'\n"
            f") AS resultado;"
        )
    return "\n\n-- COMMAND ----------\n\n".join(cells) + "\n"


def split_tests_by_dependency() -> tuple[list[Path], list[Path]]:
    """Separa los tests segun dependan o no de la capa marts.

    Los que no dependen de marts se ejecutan ANTES de publicarlos: asi un dato que
    incumple una regla de negocio nunca llega a las tablas que consume negocio.
    """
    pre, post = [], []
    for path in sorted(TESTS_DIR.glob("*.sql")):
        refs = RE_REF.findall(path.read_text(encoding="utf-8"))
        (post if any(MODEL_SCHEMA.get(r) == "marts" for r in refs) else pre).append(path)
    return pre, post


def build_notebook(key: str, cfg: dict, catalog: str) -> str:
    cells: list[str] = [
        "-- Databricks notebook source",
        f"-- MAGIC %md\n-- MAGIC # {cfg['title']}\n"
        "-- MAGIC\n"
        "-- MAGIC > Generado automaticamente desde el proyecto dbt con\n"
        "-- MAGIC > `python databricks/build_databricks_notebooks.py`.\n"
        "-- MAGIC > **No editar a mano**: modifica el modelo dbt y regenera.",
        f"CREATE SCHEMA IF NOT EXISTS {catalog}.{cfg['schema']};",
    ]

    for model in cfg["models"]:
        body = compile_model(model, catalog)
        target = f"{catalog}.{cfg['schema']}.{model}"
        cells.append(
            f"-- MAGIC %md\n-- MAGIC ### `{cfg['schema']}.{model}`"
        )
        cells.append(
            f"CREATE OR REPLACE {cfg['materialization']} {target} AS\n{body}\n;"
        )

    # Celda final de control: deja evidencia de volumetria en el log del Job.
    counts = "\nUNION ALL\n".join(
        f"SELECT '{m}' AS objeto, COUNT(*) AS filas FROM {catalog}.{cfg['schema']}.{m}"
        for m in cfg["models"]
    )
    cells.append("-- MAGIC %md\n-- MAGIC ### Control de volumetria de la capa")
    cells.append(counts + "\nORDER BY objeto;")

    return "\n\n-- COMMAND ----------\n\n".join(cells) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--catalog",
        default="workspace",
        help="Catalogo de Unity Catalog (workspace en Free Edition, main en trial premium)",
    )
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for key, cfg in LAYERS.items():
        path = OUTPUT_DIR / f"{key}.sql"
        path.write_text(build_notebook(key, cfg, args.catalog), encoding="utf-8")
        print(f"{path.relative_to(HERE.parent)}  ({len(cfg['models'])} modelos)")

    pre_tests, post_tests = split_tests_by_dependency()
    for name, files, title in [
        ("02b_quality_gate", pre_tests,
         "Puerta de calidad · reglas de negocio antes de publicar los Data Marts"),
        ("04_tests", post_tests,
         "Tests de los Data Marts · reconciliacion entre capas"),
    ]:
        path = OUTPUT_DIR / f"{name}.sql"
        path.write_text(build_tests_notebook(files, args.catalog, title), encoding="utf-8")
        print(f"{path.relative_to(HERE.parent)}  ({len(files)} tests)")

    print(f"\nCatalogo objetivo: {args.catalog}. "
          f"Regenera con --catalog <nombre> si el tuyo es otro.")


if __name__ == "__main__":
    main()
